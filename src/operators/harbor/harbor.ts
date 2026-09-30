import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'
import { Configuration, ConfigureApi, MemberApi, ProjectApi, ResponseError, RobotApi } from '@linode/harbor-client-fetch'
import { getSecret } from '../../k8s'
import { waitTillAvailable } from '../../utils'
import { errors } from './lib/globals'
import manageHarborOidcConfig from './lib/managers/harbor-oidc'
import manageHarborProject from './lib/managers/harbor-project'
import { ensureRobotAccount, ensureSystemRobotSecret } from './lib/managers/harbor-robots'
import { HarborConfig, validateConfigMapData, validateSecretData } from './lib/types/oidc'

import { error, log } from 'console'
import {
  HARBOR_ROBOT_BUILD_SUFFIX,
  HARBOR_ROBOT_PULL_SUFFIX,
  HARBOR_ROBOT_PUSH_SUFFIX,
  HARBOR_TOKEN_TYPE_PULL,
  HARBOR_TOKEN_TYPE_PUSH,
  PROJECT_BUILD_PUSH_SECRET_NAME,
  PROJECT_PULL_SECRET_NAME,
  PROJECT_PUSH_SECRET_NAME,
} from './lib/consts'
import { env } from './lib/env'
import { handleErrors } from './lib/helpers'

const OPERATOR_SECRET_NAME = 'apl-harbor-operator-secret'
const OPERATOR_CONFIGMAP_NAME = 'apl-harbor-operator-cm'

const harborBaseUrl = `${env.HARBOR_BASE_URL}:${env.HARBOR_BASE_URL_PORT}/api/v2.0`
const harborHealthUrl = `${harborBaseUrl}/systeminfo`
const harborOperatorNamespace = env.HARBOR_OPERATOR_NAMESPACE

const kc = new KubeConfig()
// loadFromCluster when deploying on cluster
// loadFromDefault when locally connecting to cluster
if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
  kc.loadFromCluster()
} else {
  kc.loadFromDefault()
}
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
let reconciling = false

async function formatResponseError(err: ResponseError): Promise<string> {
  const { url, status } = err.response
  const body = await err.response.text().catch(() => '')
  return `Request: ${url}. Response: status code: ${status} - ${body}`
}

interface HarborApis {
  robotApi: RobotApi
  configureApi: ConfigureApi
  projectsApi: ProjectApi
  memberApi: MemberApi
}

async function setupHarborApis(config: HarborConfig): Promise<HarborApis> {
  const configuration = new Configuration({
    basePath: harborBaseUrl,
    username: config.harborUser,
    password: config.harborPassword,
  })
  const robotApi = new RobotApi(configuration)
  const configureApi = new ConfigureApi(configuration)
  const projectsApi = new ProjectApi(configuration)
  const memberApi = new MemberApi(configuration)
  await ensureSystemRobotSecret(robotApi, env.HARBOR_SYSTEM_ROBOTNAME, env.HARBOR_SYSTEM_NAMESPACE, k8sApi)
  return { robotApi, configureApi, projectsApi, memberApi }
}

async function syncConfig(): Promise<HarborConfig> {
  const rawSecret = (await getSecret(OPERATOR_SECRET_NAME, harborOperatorNamespace)) as Record<string, unknown>
  const secretData = validateSecretData(rawSecret)

  const configMap = await k8sApi.readNamespacedConfigMap({
    name: OPERATOR_CONFIGMAP_NAME,
    namespace: harborOperatorNamespace,
  })
  const configMapData = validateConfigMapData(configMap)

  return new HarborConfig(secretData, configMapData)
}

export default async function manageHarborProjectsAndRobotAccounts(
  namespace: string,
  harborConfig: HarborConfig,
  apis: HarborApis,
): Promise<string | null> {
  const projectName = namespace
  try {
    const projectId = await manageHarborProject(projectName, apis.projectsApi, apis.memberApi)
    if (!projectId) {
      error(`Failed to manage the project ${projectName}, skipping robot account setup`)
      return null
    }

    await ensureRobotAccount(
      namespace,
      projectName,
      harborConfig,
      apis.robotApi,
      HARBOR_ROBOT_PULL_SUFFIX,
      HARBOR_TOKEN_TYPE_PULL,
      PROJECT_PULL_SECRET_NAME,
    )
    await ensureRobotAccount(
      namespace,
      projectName,
      harborConfig,
      apis.robotApi,
      HARBOR_ROBOT_PUSH_SUFFIX,
      HARBOR_TOKEN_TYPE_PUSH,
      PROJECT_PUSH_SECRET_NAME,
    )
    await ensureRobotAccount(
      namespace,
      projectName,
      harborConfig,
      apis.robotApi,
      HARBOR_ROBOT_BUILD_SUFFIX,
      HARBOR_TOKEN_TYPE_PUSH,
      PROJECT_BUILD_PUSH_SECRET_NAME,
    )
    return projectId
  } catch (e) {
    if (e instanceof ResponseError) {
      error(`Error processing project ${projectName}: ${await formatResponseError(e)}`)
    } else {
      error(`Error processing project ${projectName}:`, e)
    }
    return null
  }
}

async function reconcile(): Promise<void> {
  if (reconciling) {
    log('Reconciliation already in progress, skipping this cycle')
    return
  }
  reconciling = true
  try {
    const harborConfig = await syncConfig()
    const apis = await setupHarborApis(harborConfig)
    await manageHarborOidcConfig(apis.configureApi, harborConfig)
    if (harborConfig.teamNamespaces.length > 0) {
      await Promise.all(
        harborConfig.teamNamespaces.map((namespace) =>
          manageHarborProjectsAndRobotAccounts(`team-${namespace}`, harborConfig, apis),
        ),
      )
    }
  } catch (e) {
    if (e instanceof ResponseError) {
      error(`Reconciliation failed: ${await formatResponseError(e)}`)
    } else {
      error('Reconciliation failed:', e)
    }
  } finally {
    handleErrors(errors)
    reconciling = false
  }
}

async function main(): Promise<void> {
  log(`Starting Harbor operator, reconciling every ${env.HARBOR_RECONCILE_INTERVAL}s`)
  await waitTillAvailable(harborHealthUrl, undefined, { confirmations: 1 })
  await reconcile()
  const intervalId = setInterval(() => {
    void reconcile()
  }, env.HARBOR_RECONCILE_INTERVAL * 1000)
  process.on('SIGTERM', () => {
    clearInterval(intervalId)
    process.exit(0)
  })
  process.on('SIGINT', () => {
    clearInterval(intervalId)
    process.exit(130)
  })
}

if (typeof require !== 'undefined' && require.main === module) {
  void main()
}
