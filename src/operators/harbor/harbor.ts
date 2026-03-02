import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'
import Operator, { ResourceEventType } from '@linode/apl-k8s-operator'
import { ConfigureApi, MemberApi, ProjectApi, RobotApi } from '@linode/harbor-client-node'
import { handleErrors, waitTillAvailable } from '../../utils'
// full list of robot permissions which are needed because we cannot do *:* anymore to allow all actions for all resources
import { errors } from './lib/globals'
import { manageHarborOidcConfig } from './lib/managers/harbor-oidc'
import manageHarborProject from './lib/managers/harbor-project'
import {
  ensureRobotAccount,
  getBearerToken
} from './lib/managers/harbor-robots'
import { HarborConfig } from './lib/types/oidc'
import { HarborState } from './lib/types/project'

import { debug, error, log } from 'console'
import {
  HARBOR_ROBOT_BUILD_SUFFIX,
  HARBOR_ROBOT_PULL_SUFFIX,
  HARBOR_ROBOT_PUSH_SUFFIX,
  HARBOR_TOKEN_TYPE_PULL,
  HARBOR_TOKEN_TYPE_PUSH,
} from './lib/consts'
import { env } from './lib/env'
let lastState: HarborState = {}
let setupSuccess = false

const harborConfig: HarborConfig = {
  harborBaseRepoUrl: '',
  harborUser: '',
  harborPassword: '',
  oidcClientId: '',
  oidcClientSecret: '',
  oidcEndpoint: '',
  oidcVerifyCert: true,
  oidcUserClaim: 'email',
  oidcAutoOnboard: true,
  oidcGroupsClaim: 'groups',
  oidcName: 'keycloak',
  oidcScope: 'openid',
  teamNamespaces: [],
}

const harborBaseUrl = `${env.HARBOR_BASE_URL}:${env.HARBOR_BASE_URL_PORT}/api/v2.0`
const harborHealthUrl = `${harborBaseUrl}/systeminfo`
const harborOperatorNamespace = env.HARBOR_OPERATOR_NAMESPACE
let robotApi: RobotApi
let configureApi: ConfigureApi
let projectsApi: ProjectApi
let memberApi: MemberApi

// Test helper function to inject mocked API clients (for testing only)
// Needed because we dont use the api's as function parameters
export function __setApiClients(
  robot: RobotApi,
  configure: ConfigureApi,
  projects: ProjectApi,
  member: MemberApi,
): void {
  if (process.env.NODE_ENV === 'test') {
    robotApi = robot
    configureApi = configure
    projectsApi = projects
    memberApi = member
  }
}

const kc = new KubeConfig()
// loadFromCluster when deploying on cluster
// loadFromDefault when locally connecting to cluster
if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
  kc.loadFromCluster()
} else {
  kc.loadFromDefault()
}
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

// Utility function to compare states
function hasStateChanged(currentState: HarborState, _lastState: HarborState): boolean {
  return Object.entries(currentState).some(([key, value]) => !value || value !== _lastState[key])
}

async function setupHarborApis(): Promise<void> {
  robotApi = new RobotApi(harborConfig.harborUser, harborConfig.harborPassword, harborBaseUrl)
  configureApi = new ConfigureApi(harborConfig.harborUser, harborConfig.harborPassword, harborBaseUrl)
  projectsApi = new ProjectApi(harborConfig.harborUser, harborConfig.harborPassword, harborBaseUrl)
  memberApi = new MemberApi(harborConfig.harborUser, harborConfig.harborPassword, harborBaseUrl)
  const bearerAuth = await getBearerToken(robotApi, env.HARBOR_SYSTEM_ROBOTNAME, env.HARBOR_SYSTEM_NAMESPACE, k8sApi)
  robotApi.setDefaultAuthentication(bearerAuth)
  configureApi.setDefaultAuthentication(bearerAuth)
  projectsApi.setDefaultAuthentication(bearerAuth)
  memberApi.setDefaultAuthentication(bearerAuth)
}

// Callbacks
const secretsAndConfigmapsCallback = async (e: any) => {
  const { object } = e
  const { metadata, data } = object

  if (object.kind === 'Secret' && metadata.name === 'apl-harbor-operator-secret') {
    harborConfig.harborPassword = Buffer.from(data.harborPassword, 'base64').toString()
    harborConfig.harborUser = Buffer.from(data.harborUser, 'base64').toString()
    harborConfig.oidcEndpoint = Buffer.from(data.oidcEndpoint, 'base64').toString()
    harborConfig.oidcClientId = Buffer.from(data.oidcClientId, 'base64').toString()
    harborConfig.oidcClientSecret = Buffer.from(data.oidcClientSecret, 'base64').toString()
  } else if (object.kind === 'ConfigMap' && metadata.name === 'apl-harbor-operator-cm') {
    harborConfig.harborBaseRepoUrl = data.harborBaseRepoUrl
    harborConfig.oidcAutoOnboard = data.oidcAutoOnboard === 'true'
    harborConfig.oidcUserClaim = data.oidcUserClaim
    harborConfig.oidcGroupsClaim = data.oidcGroupsClaim
    harborConfig.oidcName = data.oidcName
    harborConfig.oidcScope = data.oidcScope
    harborConfig.oidcVerifyCert = data.oidcVerifyCert === 'true'
    harborConfig.teamNamespaces = JSON.parse(data.teamNamespaces)
  } else return

  switch (e.type) {
    case ResourceEventType.Added:
    case ResourceEventType.Modified: {
      try {
        await runSetupHarbor()
      } catch (err) {
        debug(err)
      }
      break
    }
    default:
      break
  }
}
export default class MyOperator extends Operator {
  protected async init() {
    // Watch apl-harbor-operator-secret
    try {
      await this.watchResource('', 'v1', 'secrets', secretsAndConfigmapsCallback, harborOperatorNamespace)
    } catch (e) {
      debug(e)
    }
    // Watch apl-harbor-operator-cm
    try {
      await this.watchResource('', 'v1', 'configmaps', secretsAndConfigmapsCallback, harborOperatorNamespace)
    } catch (e) {
      debug(e)
    }
  }
}

export async function manageHarborProjectsAndRobotAccounts(namespace: string): Promise<string | null> {
  try {
    const projectName = namespace
    const projectId = await manageHarborProject(projectName, projectsApi, memberApi)
    if (!projectId) {
      error(`Failed to manage the project ${projectName}, skipping robot account setup`)
      return null
    }

    await ensureRobotAccount(
      namespace,
      projectName,
      harborConfig,
      robotApi,
      HARBOR_ROBOT_PULL_SUFFIX,
      HARBOR_TOKEN_TYPE_PULL,
    )
    await ensureRobotAccount(
      namespace,
      projectName,
      harborConfig,
      robotApi,
      HARBOR_ROBOT_PUSH_SUFFIX,
      HARBOR_TOKEN_TYPE_PUSH,
    )
    await ensureRobotAccount(
      namespace,
      projectName,
      harborConfig,
      robotApi,
      HARBOR_ROBOT_BUILD_SUFFIX,
      HARBOR_TOKEN_TYPE_PUSH,
    )
    log(`Successfully processed namespace: ${projectName}`)
    return projectId
  } catch (e) {
    error(`Error processing namespace ${namespace}:`, e)
    return null
  }
}

async function setupHarbor(): Promise<void> {
  // harborHealthUrl is an in-cluster http svc, so no multiple external dns confirmations are needed
  await waitTillAvailable(harborHealthUrl, undefined, { confirmations: 1 })
  if (!harborConfig.harborUser) return

  try {
    await setupHarborApis()
    try {
      await manageHarborOidcConfig(configureApi, harborConfig)
      setupSuccess = true
    } catch (err) {
      error('Failed to update Harbor configuration:', err)
    }
    if (errors.length > 0) handleErrors(errors)
  } catch (e) {
    error('Failed to set bearer Token for Harbor Api :', e)
  }
}

// Runners
async function checkAndExecute(): Promise<void> {
  const currentState: HarborState = {
    harborBaseRepoUrl: harborConfig.harborBaseRepoUrl,
    harborUser: harborConfig.harborUser,
    harborPassword: harborConfig.harborPassword,
    oidcClientId: harborConfig.oidcClientId,
    oidcClientSecret: harborConfig.oidcClientSecret,
    oidcEndpoint: harborConfig.oidcEndpoint,
    oidcVerifyCert: harborConfig.oidcVerifyCert,
    oidcUserClaim: harborConfig.oidcUserClaim,
    oidcAutoOnboard: harborConfig.oidcAutoOnboard,
    oidcGroupsClaim: harborConfig.oidcGroupsClaim,
    oidcName: harborConfig.oidcName,
    oidcScope: harborConfig.oidcScope,
    teamNames: harborConfig.teamNamespaces,
  }

  if (hasStateChanged(currentState, lastState)) {
    await setupHarbor()
  }

  if (!setupSuccess) await setupHarbor()

  if (
    setupSuccess &&
    currentState.teamNames &&
    currentState.teamNames.length > 0 &&
    currentState.teamNames !== lastState.teamNames
  ) {
    await Promise.all(
      currentState.teamNames.map((namespace) => {
        return manageHarborProjectsAndRobotAccounts(`team-${namespace}`)
      }),
    )
    lastState = { ...currentState }
  }
}

async function runSetupHarbor(): Promise<void> {
  try {
    await checkAndExecute()
  } catch (e) {
    debug('Error could not run setup harbor', e)
    debug('Retrying in 30 seconds')
    await new Promise((resolve) => setTimeout(resolve, 30000))
    debug('Retrying to setup harbor')
    await runSetupHarbor()
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()
  log(`Listening to secrets, configmaps and namespaces`)
  await operator.start()
  const exit = (reason: string) => {
    operator.stop()
    process.exit(0)
  }

  process.on('SIGTERM', () => exit('SIGTERM')).on('SIGINT', () => exit('SIGINT'))
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
