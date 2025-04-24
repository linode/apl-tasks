import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'
import Operator, { ResourceEventType } from '@linode/apl-k8s-operator'
import {
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
import { generate as generatePassword } from 'generate-password'
import { createBuildsK8sSecret, createK8sSecret, createSecret, getSecret, replaceSecret } from '../k8s'
import { doApiCall, handleErrors, waitTillAvailable } from '../utils'
import {
  HARBOR_BASE_URL,
  HARBOR_BASE_URL_PORT,
  HARBOR_OPERATOR_NAMESPACE,
  HARBOR_SYSTEM_NAMESPACE,
  cleanEnv,
} from '../validators'

// Interfaces
interface DependencyState {
  [key: string]: any
}

interface RobotSecret {
  id: number
  name: string
  secret: string
}

// Constants
const localEnv = cleanEnv({
  HARBOR_BASE_URL,
  HARBOR_BASE_URL_PORT,
  HARBOR_OPERATOR_NAMESPACE,
  HARBOR_SYSTEM_NAMESPACE,
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
const systemRobot: any = {
  name: 'harbor',
  duration: -1,
  description: 'Used by APL Harbor task runner',
  disable: false,
  level: 'system',
  permissions: [
    {
      kind: 'system',
      namespace: '/',
      access: [
        {
          resource: '*',
          action: '*',
        },
      ],
    },
  ],
}

const systemRobotTwo: any = {
  name: 'harbor',
  duration: -1,
  description: 'Used by APL Harbor task runner',
  disable: false,
  level: 'system',
  permissions: [
    {
      kind: 'system',
      namespace: '/',
      access: [
        {
          resource: '*',
          action: '*',
        },
      ],
    },
  ],
  secret: 'testsecret',
}

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
let robotApi
let configureApi
let projectsApi
let memberApi

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

  const config: any = {
    auth_mode: 'oidc_auth',
    oidc_admin_group: 'platform-admin',
    oidc_client_id: 'otomi',
    oidc_client_secret: env.oidcClientSecret,
    oidc_endpoint: env.oidcEndpoint,
    oidc_groups_claim: 'groups',
    oidc_name: 'otomi',
    oidc_scope: 'openid',
    oidc_verify_cert: env.oidcVerifyCert,
    oidc_user_claim: env.oidcUserClaim,
    oidc_auto_onboard: env.oidcAutoOnboard,
    project_creation_restriction: 'adminonly',
    robot_name_prefix: robotPrefix,
    self_registration: false,
  }

  try {
    const bearerAuth = await getBearerToken()
    robotApi.setDefaultAuthentication(bearerAuth)
    configureApi.setDefaultAuthentication(bearerAuth)
    projectsApi.setDefaultAuthentication(bearerAuth)
    memberApi.setDefaultAuthentication(bearerAuth)
    await doApiCall(errors, 'Putting Harbor configuration', () => configureApi.configurationsPut(config))
    if (errors.length > 0) handleErrors(errors)
    setupSuccess = true
  } catch (error) {
    console.debug('Failed to set bearer Token for Harbor Api :', error)
  }
}

async function ensureRobotSecretHasCorrectName(robotSecret: RobotSecret) {
  const preferredRobotName = `${robotPrefix}${systemRobot.name}`
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
      await k8sApi.deleteNamespacedSecret(systemSecretName, systemNamespace)
      // now, the next call might throw IF:
      // - authMode oidc was already turned on and a platform admin accidentally removed the secret
      // but that is very unlikely, an unresolvable problem and needs a manual db fix
      robotSecret = await createSystemRobotSecret()
    }
  }
  bearerAuth.accessToken = robotSecret.secret
  return bearerAuth
}

/**
 * Create Harbor robot account that is used by APL tasks
 * @note assumes OIDC is not yet configured, otherwise this operation is NOT possible
 */
async function createSystemRobotSecret(): Promise<RobotSecret> {
  const { body: robotList } = await robotApi.listRobot()
  const defaultRobotPrefix = 'robot$'
  // Also check for default robot prefix because it can happen that the robot account was created with the default prefix
  const existing = robotList.find(
    (robot) =>
      robot.name === `${robotPrefix}${systemRobot.name}` || robot.name === `${defaultRobotPrefix}${systemRobot.name}`,
  )
  if (existing?.id) {
    const existingId = existing.id
    await doApiCall(errors, `Deleting previous robot account ${systemRobot.name}`, () =>
      robotApi.deleteRobot(existingId),
    )
  }
  const robotAccount = (await doApiCall(
    errors,
    `Create robot account ${systemRobot.name} with system level perms`,
    () => robotApi.createRobot(systemRobot),
  )) as RobotCreated

  const robotSecret: RobotSecret = { id: robotAccount.id!, name: robotAccount.name!, secret: robotAccount.secret! }
  await createSecret(systemSecretName, systemNamespace, robotSecret)
  return robotSecret
}

// Process Namespace
async function processNamespace(namespace: string) {
  try {
    const projectName = namespace
    const projectReq: ProjectReq = {
      projectName,
    }
    await doApiCall(errors, `Creating project for team ${namespace}`, () => projectsApi.createProject(projectReq))

    const project = await doApiCall(errors, `Get project for team ${namespace}`, () =>
      projectsApi.getProject(projectName),
    )
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
    await doApiCall(
      errors,
      `Associating "developer" role for team "${namespace}" with harbor project "${projectName}"`,
      () => memberApi.createProjectMember(projectId, undefined, undefined, projMember),
    )
    await doApiCall(
      errors,
      `Associating "project-admin" role for "all-teams-admin" with harbor project "${projectName}"`,
      () => memberApi.createProjectMember(projectId, undefined, undefined, projAdminMember),
    )

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
async function createTeamPullRobotAccount(projectName: string): Promise<RobotCreated> {
  const secret = generatePassword({
    length: 16,
    numbers: true,
    symbols: true,
    lowercase: true,
    uppercase: true,
    exclude: String(':,;"/=|%\\\''),
  })
  console.log(`SECRET for ${projectName} in: `, secret)
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
    secret,
  }
  const fullName = `${robotPrefix}${projectRobot.name}`

  const { body: robotList } = await robotApi.listRobot(undefined, undefined, undefined, undefined, 100)
  const existing = robotList.find((i) => i.name === fullName)

  if (existing?.id) {
    const existingId = existing.id
    await doApiCall(errors, `Deleting previous pull robot account ${fullName}`, () => robotApi.deleteRobot(existingId))
  }

  const robotPullAccount = (await doApiCall(
    errors,
    `Creating pull robot account ${fullName} with project level perms`,
    () => robotApi.createRobot(projectRobot),
  )) as RobotCreated
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
async function ensureTeamPushRobotAccount(projectName: string): Promise<any> {
  const secret = generatePassword({
    length: 16,
    numbers: true,
    symbols: true,
    lowercase: true,
    uppercase: true,
    exclude: String(':,;"/=|%\\\''),
  })
  console.log(`SECRET for ${projectName} in: `, secret)
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
    secret,
  }
  const fullName = `${robotPrefix}${projectRobot.name}`

  const { body: robotList } = await robotApi.listRobot(undefined, undefined, undefined, undefined, 100)
  const existing = robotList.find((i) => i.name === fullName)

  if (existing?.name) {
    const existingId = existing.id
    await doApiCall(errors, `Deleting previous push robot account ${fullName}`, () => robotApi.deleteRobot(existingId))
  }

  const robotPushAccount = (await doApiCall(
    errors,
    `Creating push robot account ${fullName} with project level perms`,
    () => robotApi.createRobot(projectRobot),
  )) as RobotCreated
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
async function ensureTeamBuildsPushRobotAccount(projectName: string): Promise<any> {
  const secret = generatePassword({
    length: 16,
    numbers: true,
    symbols: true,
    lowercase: true,
    uppercase: true,
    exclude: String(':,;"/=|%\\\''),
  })
  console.log(`SECRET for ${projectName} in: `, secret)
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
    secret,
  }
  const fullName = `${robotPrefix}${projectRobot.name}`

  const { body: robotList } = await robotApi.listRobot(undefined, undefined, undefined, undefined, 100)
  const existing = robotList.find((i) => i.name === fullName)

  if (existing?.name) {
    const existingId = existing.id
    await doApiCall(errors, `Deleting previous build push robot account ${fullName}`, () =>
      robotApi.deleteRobot(existingId),
    )
  }

  const robotBuildsPushAccount = (await doApiCall(
    errors,
    `Creating push robot account ${fullName} with project level perms`,
    () => robotApi.createRobot(projectRobot),
  )) as RobotCreated
  if (!robotBuildsPushAccount?.id) {
    throw new Error(
      `RobotBuildsPushAccount already exists and should have been deleted beforehand. This happens when more than 100 robot accounts exist.`,
    )
  }
  return robotBuildsPushAccount
}
