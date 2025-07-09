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

// Interfaces
interface DependencyState {
  [key: string]: any
}

interface RobotSecret {
  id: number
  name: string
  secret: string
}

interface RobotAccess {
  resource: string
  action: string
}

interface RobotPermission {
  kind: 'project' | 'system'
  namespace: string
  access: RobotAccess[]
}

interface RobotAccount {
  name: string
  duration: number
  description: string
  disable: boolean
  level: 'project' | 'system'
  permissions: RobotPermission[]
}

// Constants
const localEnv = cleanEnv({
  HARBOR_BASE_URL,
  HARBOR_BASE_URL_PORT,
  HARBOR_OPERATOR_NAMESPACE,
  HARBOR_SYSTEM_NAMESPACE,
  HARBOR_SYSTEM_ROBOTNAME,
})

const HarborRole = {
  admin: 1,
  developer: 2,
  guest: 3,
  master: 4,
}

const HarborGroupType = {
  ldap: 1,
  http: 2,
}

let lastState: DependencyState = {}
let setupSuccess = false
const errors: string[] = []

const robotPrefix = 'otomi-'
const env = {
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
const systemSecretName = 'harbor-robot-admin'
const projectPullSecretName = 'harbor-pullsecret'
const projectPushSecretName = 'harbor-pushsecret'
const projectBuildPushSecretName = 'harbor-pushsecret-builds'
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
function hasStateChanged(currentState: DependencyState, _lastState: DependencyState): boolean {
  return Object.entries(currentState).some(([key, value]) => !value || value !== _lastState[key])
}

// Callbacks
const secretsAndConfigmapsCallback = async (e: any) => {
  const { object } = e
  const { metadata, data } = object

  if (object.kind === 'Secret' && metadata.name === 'apl-harbor-operator-secret') {
    env.harborPassword = Buffer.from(data.harborPassword, 'base64').toString()
    env.harborUser = Buffer.from(data.harborUser, 'base64').toString()
    env.oidcEndpoint = Buffer.from(data.oidcEndpoint, 'base64').toString()
    env.oidcClientId = Buffer.from(data.oidcClientId, 'base64').toString()
    env.oidcClientSecret = Buffer.from(data.oidcClientSecret, 'base64').toString()
  } else if (object.kind === 'ConfigMap' && metadata.name === 'apl-harbor-operator-cm') {
    env.harborBaseRepoUrl = data.harborBaseRepoUrl
    env.oidcAutoOnboard = data.oidcAutoOnboard === 'true'
    env.oidcUserClaim = data.oidcUserClaim
    env.oidcGroupsClaim = data.oidcGroupsClaim
    env.oidcName = data.oidcName
    env.oidcScope = data.oidcScope
    env.oidcVerifyCert = data.oidcVerifyCert === 'true'
    env.teamNamespaces = JSON.parse(data.teamNamespaces)
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
  const currentState: DependencyState = {
    harborBaseRepoUrl: env.harborBaseRepoUrl,
    harborUser: env.harborUser,
    harborPassword: env.harborPassword,
    oidcClientId: env.oidcClientId,
    oidcClientSecret: env.oidcClientSecret,
    oidcEndpoint: env.oidcEndpoint,
    oidcVerifyCert: env.oidcVerifyCert,
    oidcUserClaim: env.oidcUserClaim,
    oidcAutoOnboard: env.oidcAutoOnboard,
    oidcGroupsClaim: env.oidcGroupsClaim,
    oidcName: env.oidcName,
    oidcScope: env.oidcScope,
    teamNames: env.teamNamespaces,
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
  if (!env.harborUser) return

  robotApi = new RobotApi(env.harborUser, env.harborPassword, harborBaseUrl)
  configureApi = new ConfigureApi(env.harborUser, env.harborPassword, harborBaseUrl)
  projectsApi = new ProjectApi(env.harborUser, env.harborPassword, harborBaseUrl)
  memberApi = new MemberApi(env.harborUser, env.harborPassword, harborBaseUrl)

  const config: Configurations = {
    authMode: 'oidc_auth',
    oidcAdminGroup: 'platform-admin',
    oidcClientId: 'otomi',
    oidcClientSecret: env.oidcClientSecret,
    oidcEndpoint: env.oidcEndpoint,
    oidcGroupsClaim: 'groups',
    oidcName: 'otomi',
    oidcScope: 'openid',
    oidcVerifyCert: env.oidcVerifyCert,
    oidcUserClaim: env.oidcUserClaim,
    oidcAutoOnboard: env.oidcAutoOnboard,
    projectCreationRestriction: 'adminonly',
    robotNamePrefix: robotPrefix,
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
  const preferredRobotName = `${robotPrefix}${localEnv.HARBOR_SYSTEM_ROBOTNAME}`
  if (robotSecret.name !== preferredRobotName) {
    const updatedRobotSecret = { ...robotSecret, name: preferredRobotName }
    await replaceSecret(systemSecretName, systemNamespace, updatedRobotSecret)
  }
}

/**
 * Get token by reading access token from kubernetes secret.
 * If the secret does not exists then create Harbor robot account and populate credentials to kubernetes secret.
 */
async function getBearerToken(): Promise<HttpBearerAuth> {
  const bearerAuth: HttpBearerAuth = new HttpBearerAuth()

  let robotSecret = (await getSecret(systemSecretName, systemNamespace)) as RobotSecret
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
      await k8sApi.deleteNamespacedSecret({ name: systemSecretName, namespace: systemNamespace })
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
      robot.name === `${robotPrefix}${localEnv.HARBOR_SYSTEM_ROBOTNAME}` ||
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
  await createSecret(systemSecretName, systemNamespace, robotSecret)
  return robotSecret
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
      if (!e.body.errors[0]?.message?.includes('already exists'))
        errors.push(`Error creating project for team ${namespace}: ${e}`)
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
      if (!e.body.errors[0]?.message?.includes('already exists'))
        errors.push(`Error associating developer role for team ${namespace}: ${e}`)
    }
    try {
      console.info(`Associating "project-admin" role for "all-teams-admin" with harbor project "${projectName}"`)
      await memberApi.createProjectMember(projectId, undefined, undefined, projAdminMember)
    } catch (e) {
      if (!e.body.errors[0]?.message?.includes('already exists'))
        errors.push(`Error associating project-admin role for all-teams-admin: ${e}`)
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
  const k8sSecret = await getSecret(projectPullSecretName, namespace)
  if (!k8sSecret) {
    const robotPullAccount = await createTeamPullRobotAccount(projectName)
    console.debug(`Creating pull secret/${projectPullSecretName} at ${namespace} namespace`)
    await createK8sSecret({
      namespace,
      name: projectPullSecretName,
      server: `${env.harborBaseRepoUrl}`,
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
  const fullName = `${robotPrefix}${projectRobot.name}`

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
  const k8sSecret = await getSecret(projectPushSecretName, namespace)
  if (!k8sSecret) {
    const robotPushAccount = await ensureTeamPushRobotAccount(projectName)
    console.debug(`Creating push secret/${projectPushSecretName} at ${namespace} namespace`)
    await createK8sSecret({
      namespace,
      name: projectPushSecretName,
      server: `${env.harborBaseRepoUrl}`,
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
  const fullName = `${robotPrefix}${projectRobot.name}`

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
  const k8sSecret = await getSecret(projectBuildPushSecretName, namespace)
  if (!k8sSecret) {
    const robotBuildsPushAccount = await ensureTeamBuildsPushRobotAccount(projectName)
    console.debug(`Creating build push secret/${projectBuildPushSecretName} at ${namespace} namespace`)
    await createBuildsK8sSecret({
      namespace,
      name: projectBuildPushSecretName,
      server: `${env.harborBaseRepoUrl}`,
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
  const fullName = `${robotPrefix}${projectRobot.name}`

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
