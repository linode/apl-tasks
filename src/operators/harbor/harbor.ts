import { RobotApi } from '@linode/harbor-client-node'
import dotenv from 'dotenv'
import { handleErrors, waitTillAvailable } from '../../utils'
import {
  cleanEnv,
  HARBOR_BASE_URL,
  HARBOR_BASE_URL_PORT,
  HARBOR_OPERATOR_NAMESPACE,
  HARBOR_SETUP_POLL_INTERVAL_SECONDS,
  HARBOR_SYSTEM_NAMESPACE,
  HARBOR_SYSTEM_ROBOTNAME,
} from '../../validators'
// full list of robot permissions which are needed because we cannot do *:* anymore to allow all actions for all resources
import { error, log } from 'console'
import { errors, operatorConfigMapName, operatorSecretName, robotPrefix } from './const'
import {
  applyHarborConfiguration,
  createHarborApis,
  HarborApis,
  HarborConfig,
  processNamespace as processHarborNamespace,
} from './harbor-api'
import { createCoreV1Api, syncOperatorInputs } from './harbor-k8s'
import {
  ensureTeamBuildPushRobotAccountSecret,
  ensureTeamPullRobotAccountSecret,
  ensureTeamPushRobotAccountSecret,
  getBearerToken,
} from './harbor-robots'

// Constants
const localEnv = cleanEnv({
  HARBOR_BASE_URL,
  HARBOR_BASE_URL_PORT,
  HARBOR_OPERATOR_NAMESPACE,
  HARBOR_SETUP_POLL_INTERVAL_SECONDS,
  HARBOR_SYSTEM_NAMESPACE,
  HARBOR_SYSTEM_ROBOTNAME,
})

const systemNamespace = localEnv.HARBOR_SYSTEM_NAMESPACE
const harborBaseUrl = `${localEnv.HARBOR_BASE_URL}:${localEnv.HARBOR_BASE_URL_PORT}/api/v2.0`
const harborHealthUrl = `${harborBaseUrl}/systeminfo`
const harborOperatorNamespace = localEnv.HARBOR_OPERATOR_NAMESPACE
const harborSetupPollIntervalMs = localEnv.HARBOR_SETUP_POLL_INTERVAL_SECONDS * 1000
let setupPollingInterval: NodeJS.Timeout | undefined
let setupPollingInProgress = false
let harborApis: HarborApis | undefined
const k8sApi = createCoreV1Api()

async function pollAndRunSetup(): Promise<void> {
  if (setupPollingInProgress) return
  setupPollingInProgress = true
  try {
    const desiredConfig = await syncOperatorInputs(
      k8sApi,
      harborOperatorNamespace,
      operatorSecretName,
      operatorConfigMapName,
    )
    await checkAndExecute(desiredConfig)
  } catch (err) {
    error('Error during Harbor setup poll execution', err)
  } finally {
    setupPollingInProgress = false
  }
}

// Setup Harbor
async function setupHarbor(desiredConfig: HarborConfig, robotApiClientForConfig: RobotApi): Promise<void> {
  const bearerAuth = await getBearerToken({
    desiredConfig,
    robotApiClient: robotApiClientForConfig,
    systemNamespace,
    systemRobotName: localEnv.HARBOR_SYSTEM_ROBOTNAME,
    errors,
  })
  harborApis = createHarborApis({
    harborUser: desiredConfig.harborUser,
    harborPassword: desiredConfig.harborPassword,
    harborBaseUrl,
    bearerAuth,
  })

  try {
    try {
      log('Putting Harbor configuration')
      await applyHarborConfiguration(harborApis.configureApi, desiredConfig, robotPrefix)
      log('Harbor configuration updated successfully')
    } catch (err) {
      error('Failed to update Harbor configuration:', err)
    }
    if (errors.length > 0) handleErrors(errors)
  } catch (err) {
    error('Failed to set bearer Token for Harbor Api :', err)
  }
}

// Runners
async function checkAndExecute(desiredConfig: HarborConfig): Promise<void> {
  // harborHealthUrl is an in-cluster http svc, so no multiple external dns confirmations are needed
  await waitTillAvailable(harborHealthUrl, undefined, { confirmations: 1 })
  const robotApiClientForConfig = new RobotApi(desiredConfig.harborUser, desiredConfig.harborPassword, harborBaseUrl)
  await setupHarbor(desiredConfig, robotApiClientForConfig)
  if (!harborApis) throw new Error('Harbor APIs are not initialized')
  const robotDeps = {
    desiredConfig,
    robotApiClient: robotApiClientForConfig,
    systemNamespace,
    systemRobotName: localEnv.HARBOR_SYSTEM_ROBOTNAME,
    errors,
  }
  await Promise.all(
    desiredConfig.teamNamespaces.map(async (namespace) => {
      const teamNamespace = `team-${namespace}`
      await processHarborNamespace(harborApis as HarborApis, errors, teamNamespace)
      await ensureTeamPullRobotAccountSecret(robotDeps, teamNamespace, teamNamespace)
      await ensureTeamPushRobotAccountSecret(robotDeps, teamNamespace, teamNamespace)
      await ensureTeamBuildPushRobotAccountSecret(robotDeps, teamNamespace, teamNamespace)
    }),
  )
}
// Operator
function startPolling(): void {
  void pollAndRunSetup()
  setupPollingInterval = setInterval(() => {
    void pollAndRunSetup()
  }, harborSetupPollIntervalMs)
}

function main(): void {
  // And to avoid npm trying to check for updates
  process.env.NO_UPDATE_NOTIFIER = 'true'
  // skip loading local .env in test context, and instead load the sample env
  if (process.env.NODE_ENV === 'test') {
    dotenv.config({ path: '.env.sample' })
  } else {
    dotenv.config()
  }
  log(`Polling Harbor setup every ${localEnv.HARBOR_SETUP_POLL_INTERVAL_SECONDS} seconds`)
  startPolling()
  const exit = (): void => {
    if (setupPollingInterval) clearInterval(setupPollingInterval)
    process.exit(0)
  }

  process.on('SIGTERM', () => exit()).on('SIGINT', () => exit())
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
