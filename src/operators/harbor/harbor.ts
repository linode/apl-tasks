import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'
import {
  Configurations,
  ConfigureApi,
  HttpBearerAuth,
  MemberApi,
  ProjectApi,
  ProjectMember,
  ProjectReq,
  Robot,
  RobotApi,
  RobotCreate,
  RobotCreated,
} from '@linode/harbor-client-node'
import { randomBytes } from 'crypto'
import {
  createBuildsK8sSecret,
  createDockerconfigjsonSecret,
  createK8sSecret,
  getSecret,
  replaceSecret,
} from '../../k8s'
import { doApiCall, handleErrors, waitTillAvailable } from '../../utils'
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
import fullRobotPermissions from './harbor-full-robot-system-permissions.json'

// Interfaces
interface DependencyState {
  [key: string]: any
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

interface DockerConfigCredentials {
  username: string
  password: string
}

interface RobotAccountRef {
  id: number
  name: string
}

interface GenerateRobotAccountOptions {
  description?: string
  level: 'project' | 'system'
  kind: 'project' | 'system'
  namespace?: string
  duration?: number
  disable?: boolean
}

type RobotSpec = Pick<RobotCreate, 'name' | 'description' | 'disable' | 'level' | 'duration' | 'permissions'>

// Constants
const localEnv = cleanEnv({
  HARBOR_BASE_URL,
  HARBOR_BASE_URL_PORT,
  HARBOR_OPERATOR_NAMESPACE,
  HARBOR_SETUP_POLL_INTERVAL_SECONDS,
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
const harborSetupPollIntervalMs = localEnv.HARBOR_SETUP_POLL_INTERVAL_SECONDS * 1000
const operatorSecretName = 'apl-harbor-operator-secret'
const operatorConfigMapName = 'apl-harbor-operator-cm'
let robotApi: RobotApi
let configureApi: ConfigureApi
let projectsApi: ProjectApi
let memberApi: MemberApi
let setupPollingInterval: NodeJS.Timeout | undefined
let setupPollingInProgress = false

const dockerConfigKey = '.dockerconfigjson'

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

async function syncOperatorInputs(): Promise<void> {
  try {
    const secretRes = await k8sApi.readNamespacedSecret({
      name: operatorSecretName,
      namespace: harborOperatorNamespace,
    })
    const secretData = secretRes.data || {}
    if (secretData.harborPassword) env.harborPassword = Buffer.from(secretData.harborPassword, 'base64').toString()
    if (secretData.harborUser) env.harborUser = Buffer.from(secretData.harborUser, 'base64').toString()
    if (secretData.oidcEndpoint) env.oidcEndpoint = Buffer.from(secretData.oidcEndpoint, 'base64').toString()
    if (secretData.oidcClientId) env.oidcClientId = Buffer.from(secretData.oidcClientId, 'base64').toString()
    if (secretData.oidcClientSecret)
      env.oidcClientSecret = Buffer.from(secretData.oidcClientSecret, 'base64').toString()
  } catch (error) {
    console.debug(`Unable to read secret ${operatorSecretName} in namespace ${harborOperatorNamespace}`)
  }

  try {
    const configMapRes = await k8sApi.readNamespacedConfigMap({
      name: operatorConfigMapName,
      namespace: harborOperatorNamespace,
    })
    const configMapData = configMapRes.data || {}
    if (configMapData.harborBaseRepoUrl) env.harborBaseRepoUrl = configMapData.harborBaseRepoUrl
    if (configMapData.oidcAutoOnboard) env.oidcAutoOnboard = configMapData.oidcAutoOnboard === 'true'
    if (configMapData.oidcUserClaim) env.oidcUserClaim = configMapData.oidcUserClaim
    if (configMapData.oidcGroupsClaim) env.oidcGroupsClaim = configMapData.oidcGroupsClaim
    if (configMapData.oidcName) env.oidcName = configMapData.oidcName
    if (configMapData.oidcScope) env.oidcScope = configMapData.oidcScope
    if (configMapData.oidcVerifyCert) env.oidcVerifyCert = configMapData.oidcVerifyCert === 'true'
    if (configMapData.teamNamespaces) env.teamNamespaces = JSON.parse(configMapData.teamNamespaces)
  } catch (error) {
    console.debug(`Unable to read configmap ${operatorConfigMapName} in namespace ${harborOperatorNamespace}`)
  }
}

async function pollAndRunSetup(): Promise<void> {
  if (setupPollingInProgress) return
  setupPollingInProgress = true
  try {
    await syncOperatorInputs()
    await runSetupHarbor()
  } catch (error) {
    console.debug('Error during Harbor setup poll execution', error)
  } finally {
    setupPollingInProgress = false
  }
}

// Operator
function startPolling(): void {
  void pollAndRunSetup()
  setupPollingInterval = setInterval(() => {
    void pollAndRunSetup()
  }, harborSetupPollIntervalMs)
}

function main(): void {
  console.info(`Polling Harbor setup every ${localEnv.HARBOR_SETUP_POLL_INTERVAL_SECONDS} seconds`)
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

function generateRobotToken(): string {
  return randomBytes(32).toString('hex')
}

function buildDockerConfigJson(server: string, username: string, password: string, email?: string): string {
  return JSON.stringify({
    auths: {
      [server]: {
        username,
        password,
        email: email ?? `platform@cluster.local`,
        auth: Buffer.from(`${username}:${password}`).toString('base64'),
      },
    },
  })
}

function parseDockerConfigJson(secret: Record<string, any>, server: string): DockerConfigCredentials | undefined {
  const raw = secret?.[dockerConfigKey]
  if (!raw || typeof raw !== 'string') return undefined
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return undefined
  }
  const auths = parsed?.auths || {}
  const entry = auths[server] || Object.values(auths)[0]
  if (!entry) return undefined
  if (entry.username && entry.password) return { username: entry.username, password: entry.password }
  if (entry.auth) {
    const decoded = Buffer.from(entry.auth, 'base64').toString()
    const splitIndex = decoded.indexOf(':')
    if (splitIndex === -1) return undefined
    return { username: decoded.slice(0, splitIndex), password: decoded.slice(splitIndex + 1) }
  }
  return undefined
}

function stripRobotPrefix(name: string): string {
  return name.startsWith(robotPrefix) ? name.slice(robotPrefix.length) : name
}

async function updateRobotToken(robotId: number, robotName: string, spec: RobotSpec, token: string): Promise<void> {
  const robotUpdate: Robot = {
    id: robotId,
    name: robotName,
    description: spec.description,
    disable: spec.disable,
    level: spec.level,
    duration: spec.duration,
    permissions: spec.permissions,
    secret: token,
  }
  await doApiCall(errors, `Updating robot token for ${robotName}`, () => robotApi.updateRobot(robotId, robotUpdate))
}

async function upsertRobotAccountWithToken(spec: RobotSpec, token: string): Promise<RobotAccountRef> {
  const fullName = `${robotPrefix}${spec.name}`
  const { body: robotList } = await robotApi.listRobot(undefined, undefined, undefined, undefined, 100)
  const existing = robotList.find((i) => i.name === fullName)

  if (existing?.id) {
    await updateRobotToken(existing.id, fullName, spec, token)
    return { id: existing.id, name: fullName }
  }

  const robotAccount = (await doApiCall(errors, `Creating robot account ${fullName}`, () =>
    robotApi.createRobot({ ...spec, secret: token }),
  )) as RobotCreated
  if (!robotAccount?.id) {
    throw new Error(
      `RobotAccount already exists and should have been created beforehand. This happens when more than 100 robot accounts exist.`,
    )
  }
  await updateRobotToken(robotAccount.id, fullName, spec, token)
  return { id: robotAccount.id, name: fullName }
}

/**
 * Get token by reading access token from kubernetes secret.
 * If the secret does not exists then create Harbor robot account and populate credentials to kubernetes secret.
 */
async function getBearerToken(): Promise<HttpBearerAuth> {
  const bearerAuth: HttpBearerAuth = new HttpBearerAuth()

  const secretData = (await getSecret(systemSecretName, systemNamespace)) as Record<string, any> | undefined
  const preferredRobotName = `${robotPrefix}${localEnv.HARBOR_SYSTEM_ROBOTNAME}`

  if (!secretData) {
    const token = generateRobotToken()
    const spec = generateRobotAccount(localEnv.HARBOR_SYSTEM_ROBOTNAME, fullRobotPermissions, {
      level: 'system',
      kind: 'system',
    })
    await upsertRobotAccountWithToken(spec, token)
    await createDockerconfigjsonSecret({
      namespace: systemNamespace,
      name: systemSecretName,
      server: env.harborBaseRepoUrl,
      username: preferredRobotName,
      password: token,
    })
    bearerAuth.accessToken = token
    return bearerAuth
  }

  let creds = parseDockerConfigJson(secretData, env.harborBaseRepoUrl)
  if (!creds && secretData.name && secretData.secret) {
    const dockerConfigJson = buildDockerConfigJson(env.harborBaseRepoUrl, secretData.name, secretData.secret)
    await replaceSecret(
      systemSecretName,
      systemNamespace,
      { [dockerConfigKey]: dockerConfigJson },
      'kubernetes.io/dockerconfigjson',
    )
    creds = { username: secretData.name, password: secretData.secret }
  }
  if (!creds) {
    const token = generateRobotToken()
    const spec = generateRobotAccount(localEnv.HARBOR_SYSTEM_ROBOTNAME, fullRobotPermissions, {
      level: 'system',
      kind: 'system',
    })
    await upsertRobotAccountWithToken(spec, token)
    await replaceSecret(
      systemSecretName,
      systemNamespace,
      { [dockerConfigKey]: buildDockerConfigJson(env.harborBaseRepoUrl, preferredRobotName, token) },
      'kubernetes.io/dockerconfigjson',
    )
    bearerAuth.accessToken = token
    return bearerAuth
  }

  const spec = generateRobotAccount(stripRobotPrefix(creds.username), fullRobotPermissions, {
    level: 'system',
    kind: 'system',
  })
  await upsertRobotAccountWithToken(spec, creds.password)
  bearerAuth.accessToken = creds.password
  return bearerAuth
}

/**
 * Create Harbor robot account that is used by APL tasks
 * @note assumes OIDC is not yet configured, otherwise this operation is NOT possible
 */
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
    const token = generateRobotToken()
    const robotPullAccount = await createTeamPullRobotAccount(projectName, token)
    console.debug(`Creating pull secret/${projectPullSecretName} at ${namespace} namespace`)
    await createK8sSecret({
      namespace,
      name: projectPullSecretName,
      server: `${env.harborBaseRepoUrl}`,
      username: robotPullAccount.name,
      password: token,
    })
  } else {
    const creds = parseDockerConfigJson(k8sSecret as Record<string, any>, env.harborBaseRepoUrl)
    if (creds) {
      await createTeamPullRobotAccount(projectName, creds.password)
    }
  }
}

/**
 * Create Harbor system robot account that is scoped to a given Harbor project with pull access only.
 * @param projectName Harbor project name
 */
async function createTeamPullRobotAccount(projectName: string, token: string): Promise<RobotAccountRef> {
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
  return upsertRobotAccountWithToken(projectRobot, token)
}

/**
 * Ensure that Harbor robot account and corresponding Kubernetes push secret exist
 * @param namespace Kubernetes namespace where push secret is created
 * @param projectName Harbor project name
 */
async function ensureTeamPushRobotAccountSecret(namespace: string, projectName): Promise<void> {
  const k8sSecret = await getSecret(projectPushSecretName, namespace)
  if (!k8sSecret) {
    const token = generateRobotToken()
    const robotPushAccount = await ensureTeamPushRobotAccount(projectName, token)
    console.debug(`Creating push secret/${projectPushSecretName} at ${namespace} namespace`)
    await createK8sSecret({
      namespace,
      name: projectPushSecretName,
      server: `${env.harborBaseRepoUrl}`,
      username: robotPushAccount.name,
      password: token,
    })
  } else {
    const creds = parseDockerConfigJson(k8sSecret as Record<string, any>, env.harborBaseRepoUrl)
    if (creds) {
      await ensureTeamPushRobotAccount(projectName, creds.password)
    }
  }
}

/**
 * Create Harbor system robot account that is scoped to a given Harbor project with push and push access
 * to offer team members the option to download the kubeconfig.
 * @param projectName Harbor project name
 */
async function ensureTeamPushRobotAccount(projectName: string, token: string): Promise<RobotAccountRef> {
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
  return upsertRobotAccountWithToken(projectRobot, token)
}

/**
 * Ensure that Harbor robot account and corresponding Kubernetes push secret for builds exist
 * @param namespace Kubernetes namespace where push secret is created
 * @param projectName Harbor project name
 */
async function ensureTeamBuildPushRobotAccountSecret(namespace: string, projectName): Promise<void> {
  const k8sSecret = await getSecret(projectBuildPushSecretName, namespace)
  if (!k8sSecret) {
    const token = generateRobotToken()
    const robotBuildsPushAccount = await ensureTeamBuildsPushRobotAccount(projectName, token)
    console.debug(`Creating build push secret/${projectBuildPushSecretName} at ${namespace} namespace`)
    await createBuildsK8sSecret({
      namespace,
      name: projectBuildPushSecretName,
      server: `${env.harborBaseRepoUrl}`,
      username: robotBuildsPushAccount.name,
      password: token,
    })
  } else {
    const creds = parseDockerConfigJson(k8sSecret as Record<string, any>, env.harborBaseRepoUrl)
    if (creds) {
      await ensureTeamBuildsPushRobotAccount(projectName, creds.password)
    }
  }
}

/**
 * Create Harbor system robot account that is scoped to a given Harbor project with push access
 * for Kaniko (used for builds) task to push images.
 * @param projectName Harbor project name
 */
async function ensureTeamBuildsPushRobotAccount(projectName: string, token: string): Promise<RobotAccountRef> {
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
  return upsertRobotAccountWithToken(projectRobot, token)
}

function generateRobotAccount(
  name: string,
  accessList: RobotAccess[],
  options: GenerateRobotAccountOptions,
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
