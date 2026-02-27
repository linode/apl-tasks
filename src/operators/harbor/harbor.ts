import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'
import Operator, { ResourceEventType } from '@linode/apl-k8s-operator'
import {
  Configurations,
  ConfigureApi,
  HttpBearerAuth,
  MemberApi,
  ProjectApi,
  ProjectMember,
  ProjectReq,
  RobotApi,
  RobotCreate,
  RobotCreated,
} from '@linode/harbor-client-node'
import { createBuildsK8sSecret, createK8sSecret, createSecret, getSecret, replaceSecret } from '../../k8s'
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
import fullRobotPermissions from './harbor-full-robot-system-permissions.json'
import {
  HarborGroupType,
  HarborRole,
  PROJECT_BUILD_PUSH_SECRET_NAME,
  PROJECT_PULL_SECRET_NAME,
  PROJECT_PUSH_SECRET_NAME,
  ROBOT_PREFIX,
  SYSTEM_SECRET_NAME,
} from './lib/consts'
import { HarborState } from './lib/types/project'
import { RobotAccess, RobotAccount, RobotSecret } from './lib/types/robot'

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
const errors: string[] = []

const harborConfig = {
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

const systemNamespace = localEnv.HARBOR_SYSTEM_NAMESPACE

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

// Setup Harbor
async function setupHarbor() {
  // harborHealthUrl is an in-cluster http svc, so no multiple external dns confirmations are needed
  await waitTillAvailable(harborHealthUrl, undefined, { confirmations: 1 })
  if (!harborConfig.harborUser) return

  robotApi = new RobotApi(harborConfig.harborUser, harborConfig.harborPassword, harborBaseUrl)
  configureApi = new ConfigureApi(harborConfig.harborUser, harborConfig.harborPassword, harborBaseUrl)
  projectsApi = new ProjectApi(harborConfig.harborUser, harborConfig.harborPassword, harborBaseUrl)
  memberApi = new MemberApi(harborConfig.harborUser, harborConfig.harborPassword, harborBaseUrl)

  const config: Configurations = {
    authMode: 'oidc_auth',
    oidcAdminGroup: 'platform-admin',
    oidcClientId: 'otomi',
    oidcClientSecret: harborConfig.oidcClientSecret,
    oidcEndpoint: harborConfig.oidcEndpoint,
    oidcGroupsClaim: 'groups',
    oidcName: 'otomi',
    oidcScope: 'openid',
    oidcVerifyCert: harborConfig.oidcVerifyCert,
    oidcUserClaim: harborConfig.oidcUserClaim,
    oidcAutoOnboard: harborConfig.oidcAutoOnboard,
    projectCreationRestriction: 'adminonly',
    robotNamePrefix: ROBOT_PREFIX,
    selfRegistration: false,
    primaryAuthMode: true,
  }

  try {
    const bearerAuth = await getBearerToken()
    robotApi.setDefaultAuthentication(bearerAuth)
    configureApi.setDefaultAuthentication(bearerAuth)
    projectsApi.setDefaultAuthentication(bearerAuth)
    memberApi.setDefaultAuthentication(bearerAuth)
    try {
      console.info('Putting Harbor configuration')
      await configureApi.updateConfigurations(config)
      console.info('Harbor configuration updated successfully')
      setupSuccess = true
    } catch (err) {
      console.error('Failed to update Harbor configuration:', err)
    }
    if (errors.length > 0) handleErrors(errors)
  } catch (error) {
    console.error('Failed to set bearer Token for Harbor Api :', error)
  }
}

async function ensureRobotSecretHasCorrectName(robotSecret: RobotSecret) {
  const preferredRobotName = `${ROBOT_PREFIX}${localEnv.HARBOR_SYSTEM_ROBOTNAME}`
  if (robotSecret.name !== preferredRobotName) {
    const updatedRobotSecret = { ...robotSecret, name: preferredRobotName }
    await replaceSecret(SYSTEM_SECRET_NAME, systemNamespace, updatedRobotSecret)
  }
}

/**
 * Get token by reading access token from kubernetes secret.
 * If the secret does not exists then create Harbor robot account and populate credentials to kubernetes secret.
 */
async function getBearerToken(): Promise<HttpBearerAuth> {
  const bearerAuth: HttpBearerAuth = new HttpBearerAuth()

  let robotSecret = (await getSecret(SYSTEM_SECRET_NAME, systemNamespace)) as RobotSecret
  if (!robotSecret) {
    // not existing yet, create robot account and keep creds in secret
    robotSecret = await createSystemRobotSecret()
  } else {
    await ensureRobotSecretHasCorrectName(robotSecret)
    // test if secret still works
    try {
      bearerAuth.accessToken = robotSecret.secret
      robotApi.setDefaultAuthentication(bearerAuth)
      await robotApi.listRobot()
    } catch (e) {
      // throw everything except 401, which is what we test for
      if (e.status !== 401) throw e
      // unauthenticated, so remove and recreate secret
      await k8sApi.deleteNamespacedSecret({ name: SYSTEM_SECRET_NAME, namespace: systemNamespace })
      // now, the next call might throw IF:
      // - authMode oidc was already turned on and a platform admin accidentally removed the secret
      // but that is very unlikely, an unresolvable problem and needs a manual db fix
      robotSecret = await createSystemRobotSecret()
    }
  }
  bearerAuth.accessToken = robotSecret.secret
  return bearerAuth
}

function isRobotCreated(obj: unknown): obj is RobotCreated {
  return typeof obj === 'object' && obj !== null && 'id' in obj && 'name' in obj && 'secret' in obj
}

/**
 * Create Harbor robot account that is used by APL tasks
 * @note assumes OIDC is not yet configured, otherwise this operation is NOT possible
 */
export async function createSystemRobotSecret(): Promise<RobotSecret> {
  const { body: robotList } = await robotApi.listRobot()
  const defaultRobotPrefix = 'robot$'
  const existing = robotList.find(
    (robot) =>
      robot.name === `${ROBOT_PREFIX}${localEnv.HARBOR_SYSTEM_ROBOTNAME}` ||
      robot.name === `${defaultRobotPrefix}${localEnv.HARBOR_SYSTEM_ROBOTNAME}`,
  )
  if (existing?.id) {
    const existingId = existing.id
    try {
      console.info(`Deleting previous robot account ${localEnv.HARBOR_SYSTEM_ROBOTNAME} with id ${existingId}`)
      await robotApi.deleteRobot(existingId)
    } catch (e) {
      errors.push(`Error deleting previous robot account ${localEnv.HARBOR_SYSTEM_ROBOTNAME}: ${e}`)
    }
  }
  let robotAccount: RobotCreated
  try {
    console.info(`Creating robot account ${localEnv.HARBOR_SYSTEM_ROBOTNAME} with system level permsissions`)
    robotAccount = (
      await robotApi.createRobot(
        generateRobotAccount(localEnv.HARBOR_SYSTEM_ROBOTNAME, fullRobotPermissions, {
          level: 'system',
          kind: 'system',
        }),
      )
    ).body
  } catch (e) {
    errors.push(`Error creating robot account ${localEnv.HARBOR_SYSTEM_ROBOTNAME}: ${e}`)
    throw e
  }
  if (!isRobotCreated(robotAccount)) {
    throw new Error('Robot account creation failed: missing id, name, or secret')
  }
  const robotSecret: RobotSecret = { id: robotAccount.id!, name: robotAccount.name!, secret: robotAccount.secret! }
  await createSecret(SYSTEM_SECRET_NAME, systemNamespace, robotSecret)
  return robotSecret
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
      roleId: HarborRole.developer,
      memberGroup: {
        groupName: projectName,
        groupType: HarborGroupType.http,
      },
    }
    const projAdminMember: ProjectMember = {
      roleId: HarborRole.admin,
      memberGroup: {
        groupName: 'all-teams-admin',
        groupType: HarborGroupType.http,
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

    await ensureTeamPullRobotAccountSecret(namespace, projectName)
    await ensureTeamPushRobotAccountSecret(namespace, projectName)
    await ensureTeamBuildPushRobotAccountSecret(namespace, projectName)

    console.info(`Successfully processed namespace: ${namespace}`)
    return null
  } catch (error) {
    console.error(`Error processing namespace ${namespace}:`, error)
    return null
  }
}

/**
 * Ensure that Harbor robot account and corresponding Kubernetes pull secret exist
 * @param namespace Kubernetes namespace where pull secret is created
 * @param projectName Harbor project name
 */
async function ensureTeamPullRobotAccountSecret(namespace: string, projectName): Promise<void> {
  const k8sSecret = await getSecret(PROJECT_PULL_SECRET_NAME, namespace)
  if (!k8sSecret) {
    const robotPullAccount = await createTeamPullRobotAccount(projectName)
    console.debug(`Creating pull secret/${PROJECT_PULL_SECRET_NAME} at ${namespace} namespace`)
    await createK8sSecret({
      namespace,
      name: PROJECT_PULL_SECRET_NAME,
      server: `${harborConfig.harborBaseRepoUrl}`,
      username: robotPullAccount.name!,
      password: robotPullAccount.secret!,
    })
  }
}

/**
 * Create Harbor system robot account that is scoped to a given Harbor project with pull access only.
 * @param projectName Harbor project name
 */
export async function createTeamPullRobotAccount(projectName: string): Promise<RobotCreated> {
  const projectRobot: RobotCreate = {
    name: `${projectName}-pull`,
    duration: -1,
    description: 'Allow team to pull from its own registry',
    disable: false,
    level: 'system',
    permissions: [
      {
        kind: 'project',
        namespace: projectName,
        access: [
          {
            resource: 'repository',
            action: 'pull',
          },
        ],
      },
    ],
  }
  const fullName = `${ROBOT_PREFIX}${projectRobot.name}`

  const { body: robotList } = await robotApi.listRobot(undefined, undefined, undefined, undefined, 100)
  const existing = robotList.find((i) => i.name === fullName)

  if (existing?.id) {
    const existingId = existing.id
    try {
      console.info(`Deleting previous pull robot account ${fullName} with id ${existingId}`)
      await robotApi.deleteRobot(existingId)
    } catch (e) {
      errors.push(`Error deleting previous pull robot account ${fullName}: ${e}`)
    }
  }
  let robotPullAccount: RobotCreated
  try {
    console.info(`Creating pull robot account ${fullName} with project level permsissions`)
    const { body } = await robotApi.createRobot(projectRobot)
    robotPullAccount = body
  } catch (e) {
    errors.push(`Error creating pull robot account ${fullName}: ${e}`)
    throw e
  }
  if (!robotPullAccount?.id) {
    throw new Error(
      `RobotPullAccount already exists and should have been deleted beforehand. This happens when more than 100 robot accounts exist.`,
    )
  }
  return robotPullAccount
}

/**
 * Ensure that Harbor robot account and corresponding Kubernetes push secret exist
 * @param namespace Kubernetes namespace where push secret is created
 * @param projectName Harbor project name
 */
async function ensureTeamPushRobotAccountSecret(namespace: string, projectName): Promise<void> {
  const k8sSecret = await getSecret(PROJECT_PUSH_SECRET_NAME, namespace)
  if (!k8sSecret) {
    const robotPushAccount = await ensureTeamPushRobotAccount(projectName)
    console.debug(`Creating push secret/${PROJECT_PUSH_SECRET_NAME} at ${namespace} namespace`)
    await createK8sSecret({
      namespace,
      name: PROJECT_PUSH_SECRET_NAME,
      server: `${harborConfig.harborBaseRepoUrl}`,
      username: robotPushAccount.name!,
      password: robotPushAccount.secret!,
    })
  }
}

/**
 * Create Harbor system robot account that is scoped to a given Harbor project with push and push access
 * to offer team members the option to download the kubeconfig.
 * @param projectName Harbor project name
 */
export async function ensureTeamPushRobotAccount(projectName: string): Promise<RobotCreated> {
  const projectRobot: RobotCreate = {
    name: `${projectName}-push`,
    duration: -1,
    description: 'Allow team to push to its own registry',
    disable: false,
    level: 'system',
    permissions: [
      {
        kind: 'project',
        namespace: projectName,
        access: [
          {
            resource: 'repository',
            action: 'push',
          },
          {
            resource: 'repository',
            action: 'pull',
          },
        ],
      },
    ],
  }
  const fullName = `${ROBOT_PREFIX}${projectRobot.name}`

  const { body: robotList } = await robotApi.listRobot(undefined, undefined, undefined, undefined, 100)
  const existing = robotList.find((i) => i.name === fullName)

  if (existing?.id) {
    const existingId = existing.id
    try {
      console.info(`Deleting previous push robot account ${fullName} with id ${existingId}`)
      await robotApi.deleteRobot(existingId)
    } catch (e) {
      errors.push(`Error deleting previous push robot account ${fullName}: ${e}`)
    }
  }

  let robotPushAccount: RobotCreated
  try {
    console.info(`Creating push robot account ${fullName} with project level permsissions`)
    robotPushAccount = (await robotApi.createRobot(projectRobot)).body
  } catch (e) {
    errors.push(`Error creating push robot account ${fullName}: ${e}`)
    throw e
  }
  if (!robotPushAccount?.id) {
    throw new Error(
      `RobotPushAccount already exists and should have been deleted beforehand. This happens when more than 100 robot accounts exist.`,
    )
  }
  return robotPushAccount
}

/**
 * Ensure that Harbor robot account and corresponding Kubernetes push secret for builds exist
 * @param namespace Kubernetes namespace where push secret is created
 * @param projectName Harbor project name
 */
async function ensureTeamBuildPushRobotAccountSecret(namespace: string, projectName): Promise<void> {
  const k8sSecret = await getSecret(PROJECT_BUILD_PUSH_SECRET_NAME, namespace)
  if (!k8sSecret) {
    const robotBuildsPushAccount = await ensureTeamBuildsPushRobotAccount(projectName)
    console.debug(`Creating build push secret/${PROJECT_BUILD_PUSH_SECRET_NAME} at ${namespace} namespace`)
    await createBuildsK8sSecret({
      namespace,
      name: PROJECT_BUILD_PUSH_SECRET_NAME,
      server: `${harborConfig.harborBaseRepoUrl}`,
      username: robotBuildsPushAccount.name!,
      password: robotBuildsPushAccount.secret!,
    })
  }
}

/**
 * Create Harbor system robot account that is scoped to a given Harbor project with push access
 * for Kaniko (used for builds) task to push images.
 * @param projectName Harbor project name
 */
export async function ensureTeamBuildsPushRobotAccount(projectName: string): Promise<RobotCreated> {
  const projectRobot: RobotCreate = {
    name: `${projectName}-builds`,
    duration: -1,
    description: 'Allow builds to push images',
    disable: false,
    level: 'system',
    permissions: [
      {
        kind: 'project',
        namespace: projectName,
        access: [
          {
            resource: 'repository',
            action: 'push',
          },
          {
            resource: 'repository',
            action: 'pull',
          },
        ],
      },
    ],
  }
  const fullName = `${ROBOT_PREFIX}${projectRobot.name}`

  const { body: robotList } = await robotApi.listRobot(undefined, undefined, undefined, undefined, 100)
  const existing = robotList.find((i) => i.name === fullName)

  if (existing?.id) {
    const existingId = existing.id
    try {
      console.info(`Deleting previous build push robot account ${fullName} with id ${existingId}`)
      await robotApi.deleteRobot(existingId)
    } catch (e) {
      errors.push(`Error deleting previous build push robot account ${fullName}: ${e}`)
    }
  }

  let robotBuildsPushAccount: RobotCreated
  try {
    console.info(`Creating build push robot account ${fullName} with project level permsissions`)
    robotBuildsPushAccount = (await robotApi.createRobot(projectRobot)).body
  } catch (e) {
    errors.push(`Error creating build push robot account ${fullName}: ${e}`)
    throw e
  }
  if (!robotBuildsPushAccount?.id) {
    throw new Error(
      `RobotBuildsPushAccount already exists and should have been deleted beforehand. This happens when more than 100 robot accounts exist.`,
    )
  }
  return robotBuildsPushAccount
}

function generateRobotAccount(
  name: string,
  accessList: RobotAccess[],
  options: {
    description?: string
    level: 'project' | 'system'
    kind: 'project' | 'system'
    namespace?: string
    duration?: number
    disable?: boolean
  },
): RobotAccount {
  const {
    description = options?.description || `Robot account for ${name}`,
    level = options.level,
    kind = options.kind,
    namespace = options?.namespace || '/',
    duration = options?.duration || -1,
    disable = options?.disable || false,
  } = options || {}

  return {
    name,
    duration,
    description,
    disable,
    level,
    permissions: [
      {
        kind,
        namespace,
        access: accessList,
      },
    ],
  }
}
