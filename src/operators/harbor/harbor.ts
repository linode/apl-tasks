import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'
import Operator, { ResourceEventType } from '@linode/apl-k8s-operator'
import { ConfigureApi, MemberApi, ProjectApi, ProjectMember, ProjectReq, RobotApi } from '@linode/harbor-client-node'
import { handleErrors, waitTillAvailable } from '../../utils'
import {
  cleanEnv,
  HARBOR_BASE_URL,
  HARBOR_BASE_URL_PORT,
  HARBOR_OPERATOR_NAMESPACE,
  HARBOR_SYSTEM_NAMESPACE,
  HARBOR_SYSTEM_ROBOTNAME,
} from '../../validators'
// full list of robot permissions which are needed because we cannot do *:* anymore to allow all actions for all resources
import { HARBOR_GROUP_TYPE, HARBOR_ROLE } from './lib/consts'
import { errors } from './lib/globals'
import { manageHarborOidcConfig } from './lib/managers/harbor-oidc'
import {
  ensureTeamBuildPushRobotAccountSecret,
  ensureTeamPullRobotAccountSecret,
  ensureTeamPushRobotAccountSecret,
  getBearerToken,
} from './lib/managers/harbor-robots'
import { HarborConfig } from './lib/types/oidc'
import { HarborState } from './lib/types/project'
// Constants
const localEnv = cleanEnv({
  HARBOR_BASE_URL,
  HARBOR_BASE_URL_PORT,
  HARBOR_OPERATOR_NAMESPACE,
  HARBOR_SYSTEM_NAMESPACE,
  HARBOR_SYSTEM_ROBOTNAME,
})

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

const harborBaseUrl = `${localEnv.HARBOR_BASE_URL}:${localEnv.HARBOR_BASE_URL_PORT}/api/v2.0`
const harborHealthUrl = `${harborBaseUrl}/systeminfo`
const harborOperatorNamespace = localEnv.HARBOR_OPERATOR_NAMESPACE
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
      } catch (error) {
        console.debug(error)
      }
      break
    }
    default:
      break
  }
}

// Operator
export default class MyOperator extends Operator {
  protected async init() {
    // Watch apl-harbor-operator-secret
    try {
      await this.watchResource('', 'v1', 'secrets', secretsAndConfigmapsCallback, harborOperatorNamespace)
    } catch (error) {
      console.debug(error)
    }
    // Watch apl-harbor-operator-cm
    try {
      await this.watchResource('', 'v1', 'configmaps', secretsAndConfigmapsCallback, harborOperatorNamespace)
    } catch (error) {
      console.debug(error)
    }
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()
  console.info(`Listening to secrets, configmaps and namespaces`)
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

// Runners
async function checkAndExecute() {
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
    await Promise.all(currentState.teamNames.map((namespace) => processNamespace(`team-${namespace}`)))
    lastState = { ...currentState }
  }
}

async function runSetupHarbor() {
  try {
    await checkAndExecute()
  } catch (error) {
    console.debug('Error could not run setup harbor', error)
    console.debug('Retrying in 30 seconds')
    await new Promise((resolve) => setTimeout(resolve, 30000))
    console.debug('Retrying to setup harbor')
    await runSetupHarbor()
  }
}

async function setupHarborApis(): Promise<void> {
  robotApi = new RobotApi(harborConfig.harborUser, harborConfig.harborPassword, harborBaseUrl)
  configureApi = new ConfigureApi(harborConfig.harborUser, harborConfig.harborPassword, harborBaseUrl)
  projectsApi = new ProjectApi(harborConfig.harborUser, harborConfig.harborPassword, harborBaseUrl)
  memberApi = new MemberApi(harborConfig.harborUser, harborConfig.harborPassword, harborBaseUrl)
  const bearerAuth = await getBearerToken(
    robotApi,
    localEnv.HARBOR_SYSTEM_ROBOTNAME,
    localEnv.HARBOR_SYSTEM_NAMESPACE,
    k8sApi,
  )
  robotApi.setDefaultAuthentication(bearerAuth)
  configureApi.setDefaultAuthentication(bearerAuth)
  projectsApi.setDefaultAuthentication(bearerAuth)
  memberApi.setDefaultAuthentication(bearerAuth)
}

// Setup Harbor
async function setupHarbor() {
  // harborHealthUrl is an in-cluster http svc, so no multiple external dns confirmations are needed
  await waitTillAvailable(harborHealthUrl, undefined, { confirmations: 1 })
  if (!harborConfig.harborUser) return

  try {
    await setupHarborApis()
    try {
      await manageHarborOidcConfig(configureApi, harborConfig)
      setupSuccess = true
    } catch (err) {
      console.error('Failed to update Harbor configuration:', err)
    }
    if (errors.length > 0) handleErrors(errors)
  } catch (error) {
    console.error('Failed to set bearer Token for Harbor Api :', error)
  }
}

function alreadyExistsError(e): boolean {
  if (e && e.body && e.body.errors && e.body.errors.length > 0) {
    return e.body.errors[0].message.includes('already exists')
  }
  return false
}

// Process Namespace
export async function processNamespace(namespace: string): Promise<string | null> {
  try {
    const projectName = namespace
    const projectReq: ProjectReq = {
      projectName,
    }
    try {
      console.info(`Creating project for team ${namespace}`)
      await projectsApi.createProject(projectReq)
    } catch (e) {
      if (!alreadyExistsError(e)) errors.push(`Error creating project for team ${namespace}: ${e}`)
    }

    let project
    try {
      project = (await projectsApi.getProject(projectName)).body
    } catch (e) {
      errors.push(`Error getting project for team ${namespace}: ${e}`)
    }
    if (!project) return ''
    const projectId = `${project.projectId}`

    const projMember: ProjectMember = {
      roleId: HARBOR_ROLE.developer,
      memberGroup: {
        groupName: projectName,
        groupType: HARBOR_GROUP_TYPE.http,
      },
    }
    const projAdminMember: ProjectMember = {
      roleId: HARBOR_ROLE.admin,
      memberGroup: {
        groupName: 'all-teams-admin',
        groupType: HARBOR_GROUP_TYPE.http,
      },
    }
    try {
      console.info(`Associating "developer" role for team "${namespace}" with harbor project "${projectName}"`)
      await memberApi.createProjectMember(projectId, undefined, undefined, projMember)
    } catch (e) {
      if (!alreadyExistsError(e)) errors.push(`Error associating developer role for team ${namespace}: ${e}`)
    }
    try {
      console.info(`Associating "project-admin" role for "all-teams-admin" with harbor project "${projectName}"`)
      await memberApi.createProjectMember(projectId, undefined, undefined, projAdminMember)
    } catch (e) {
      if (!alreadyExistsError(e)) errors.push(`Error associating project-admin role for all-teams-admin: ${e}`)
    }

    await ensureTeamPullRobotAccountSecret(namespace, projectName, harborConfig, robotApi)
    await ensureTeamPushRobotAccountSecret(namespace, projectName, harborConfig, robotApi)
    await ensureTeamBuildPushRobotAccountSecret(namespace, projectName, harborConfig, robotApi)

    console.info(`Successfully processed namespace: ${namespace}`)
    return null
  } catch (error) {
    console.error(`Error processing namespace ${namespace}:`, error)
    return null
  }
}
