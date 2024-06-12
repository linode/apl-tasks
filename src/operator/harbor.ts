import Operator, { ResourceEventType } from '@dot-i/k8s-operator'
import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'
import {
  ConfigureApi,
  HttpBearerAuth,
  MemberApi,
  ProjectApi,
  // eslint-disable-next-line no-unused-vars
  ProjectMember,
  // eslint-disable-next-line no-unused-vars
  ProjectReq,
  RobotApi,
  // eslint-disable-next-line no-unused-vars
  RobotCreate,
  // eslint-disable-next-line no-unused-vars
  RobotCreated,
} from '@redkubes/harbor-client-node'
import { createBuildsK8sSecret, createK8sSecret, createSecret, getSecret } from '../k8s'
import { doApiCall, handleErrors, waitTillAvailable } from '../utils'

interface groupMapping {
  [key: string]: {
    otomi: string[]
  }
}

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

const errors: string[] = []

export interface RobotSecret {
  id: number
  name: string
  secret: string
}

const systemRobot: any = {
  name: 'harbor',
  duration: -1,
  description: 'Used by Otomi Harbor task runner',
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

const robotPrefix = 'otomi-'
const harborOperator = {
  harborBaseUrl: 'http://harbor-core.harbor',
  harborBaseRepoUrl: 'harbor.172.233.37.26.nip.io',
  harborUser: 'admin',
  harborPassword: 'welcomeotomi',
  teamIds: [],
  oidcClientId: '',
  oidcClientSecret: '',
  oidcEndpoint: '',
  oidcVerifyCert: true,
  oidcUserClaim: 'email',
  oidcAutoOnboard: true,
  oidcGroupsClaim: 'groups',
  oidcName: 'keycloak',
  oidcScope: 'openid',
}
const config: any = {
  auth_mode: 'oidc_auth',
  oidc_admin_group: 'admin',
  oidc_client_id: 'otomi',
  oidc_client_secret: harborOperator.oidcClientSecret,
  oidc_endpoint: harborOperator.oidcEndpoint,
  oidc_groups_claim: 'groups',
  oidc_name: 'otomi',
  oidc_scope: 'openid',
  oidc_verify_cert: harborOperator.oidcVerifyCert,
  oidc_user_claim: harborOperator.oidcUserClaim,
  oidc_auto_onboard: harborOperator.oidcAutoOnboard,
  project_creation_restriction: 'adminonly',
  robot_name_prefix: robotPrefix,
  self_registration: false,
}

const systemNamespace = 'harbor'
const systemSecretName = 'harbor-robot-admin'
const projectPullSecretName = 'harbor-pullsecret'
const projectPushSecretName = 'harbor-pushsecret'
const projectBuildPushSecretName = 'harbor-pushsecret-builds'
// const harborBaseUrl = `https://harbor.172.233.37.26.nip.io/api/v2.0`
// const harborHealthUrl = `${harborBaseUrl}/systeminfo`
const robotApi = new RobotApi(harborOperator.harborUser, harborOperator.harborPassword, harborOperator.harborBaseUrl)
const configureApi = new ConfigureApi(
  harborOperator.harborUser,
  harborOperator.harborPassword,
  harborOperator.harborBaseUrl,
)
const projectsApi = new ProjectApi(
  harborOperator.harborUser,
  harborOperator.harborPassword,
  harborOperator.harborBaseUrl,
)
const memberApi = new MemberApi(harborOperator.harborUser, harborOperator.harborPassword, harborOperator.harborBaseUrl)

const kc = new KubeConfig()
// loadFromCluster when deploying on cluster
// loadFromDefault when locally connecting to cluster
if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
  kc.loadFromCluster()
} else {
  kc.loadFromDefault()
}
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

// Callbacks
const secretsAndConfigmapsCallback = async (e: any) => {
  const { object } = e
  const { metadata, data } = object

  if (object.kind === 'Secret' && metadata.name === 'harbor-admin') {
    console.log('Secret:', metadata.name)
    harborOperator.harborPassword = Buffer.from(data.harborPassword, 'base64').toString()
    harborOperator.harborUser = Buffer.from(data.harborUser, 'base64').toString()
    harborOperator.oidcEndpoint = Buffer.from(data.oidcEndpoint, 'base64').toString()
    harborOperator.oidcClientId = Buffer.from(data.oidcClientId, 'base64').toString()
    harborOperator.oidcClientSecret = Buffer.from(data.oidcClientSecret, 'base64').toString()
  } else if (object.kind === 'ConfigMap' && metadata.name === 'harbor-operator-cm') {
    console.log('ConfigMap:', metadata.name)
    harborOperator.harborBaseUrl = data.harborBaseUrl
    harborOperator.harborBaseRepoUrl = data.harborBaseRepoUrl
    harborOperator.teamIds = JSON.parse(data.teamIds)
    harborOperator.oidcAutoOnboard = data.oidcAutoOnboard
    harborOperator.oidcUserClaim = data.oidcUserClaim
    harborOperator.oidcGroupsClaim = data.oidcGroupsClaim
    harborOperator.oidcName = data.oidcName
    harborOperator.oidcScope = data.oidcScope
    harborOperator.oidcVerifyCert = data.oidcVerifyCert
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

const namespacesCallback = async (e: any) => {
  const { object }: { object: k8s.V1Pod } = e
  const { metadata } = object
  // Check if namespace starts with prefix 'team-'
  if (metadata && !metadata.name?.startsWith('team-')) return
  if (metadata && metadata.name === 'team-admin') return
  await new Promise((resolve) => setTimeout(resolve, 1000))
  console.info(`Namespace:`, metadata?.name)
}

// Operator
export default class MyOperator extends Operator {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  protected async init() {
    // Watch harbor-operator-secrets
    try {
      await this.watchResource('', 'v1', 'secrets', secretsAndConfigmapsCallback, 'harbor-operator')
    } catch (error) {
      console.debug(error)
    }
    // Watch harbor-operator-cm
    try {
      await this.watchResource('', 'v1', 'configmaps', secretsAndConfigmapsCallback, 'harbor-operator')
    } catch (error) {
      console.debug(error)
    }
    // Watch all namespaces
    try {
      await this.watchResource('', 'v1', 'namespaces', namespacesCallback)
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
async function runSetupHarbor() {
  try {
    await setupHarbor()
  } catch (error) {
    console.debug('Error could not run setup harbor', error)
    console.debug('Retrying in 30 seconds')
    await new Promise((resolve) => setTimeout(resolve, 30000))
    console.debug('Retrying to setup harbor')
    await runSetupHarbor()
  }
}

// Setup Harbor

/**
 * Create Harbor robot account that is used by Otomi tasks
 * @note assumes OIDC is not yet configured, otherwise this operation is NOT possible
 */
async function createSystemRobotSecret(): Promise<RobotSecret> {
  const { body: robotList } = await robotApi.listRobot()
  console.log('robotApi', robotApi)
  const existing = robotList.find((i) => i.name === `${robotPrefix}${systemRobot.name}`)
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
  console.log('robotAccount', robotAccount)
  console.log('errors', errors)
  const robotSecret: RobotSecret = { id: robotAccount.id!, name: robotAccount.name!, secret: robotAccount.secret! }
  await createSecret(systemSecretName, systemNamespace, robotSecret)
  return robotSecret
}

/**
 * Create Harbor system robot account that is scoped to a given Harbor project with pull access only.
 * @param projectName Harbor project name
 */
async function createTeamPullRobotAccount(projectName: string): Promise<RobotCreated> {
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
 * Create Harbor system robot account that is scoped to a given Harbor project with push and push access
 * to offer team members the option to download the kubeconfig.
 * @param projectName Harbor project name
 */
async function ensureTeamPushRobotAccount(projectName: string): Promise<any> {
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

  if (existing?.name) {
    return existing
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
 * Create Harbor system robot account that is scoped to a given Harbor project with push access
 * for Kaniko (used for builds) task to push images.
 * @param projectName Harbor project name
 */
async function ensureTeamBuildsPushRobotAccount(projectName: string): Promise<any> {
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

  if (existing?.name) {
    return existing
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
      // - authMode oidc was already turned on and an otomi admin accidentally removed the secret
      // but that is very unlikely, an unresolvable problem and needs a manual db fix
      robotSecret = await createSystemRobotSecret()
    }
  }
  bearerAuth.accessToken = robotSecret.secret
  return bearerAuth
}

/**
 * Ensure that Harbor robot account and corresponding Kubernetes pull secret exist
 * @param namespace Kubernetes namespace where pull secret is created
 * @param projectName Harbor project name
 */
async function ensureTeamPullRobotAccountSecret(namespace: string, projectName): Promise<void> {
  const k8sSecret = await getSecret(projectPullSecretName, namespace)
  if (k8sSecret) {
    console.debug(`Deleting pull secret/${projectPullSecretName} from ${namespace} namespace`)
    await k8sApi.deleteNamespacedSecret(projectPullSecretName, namespace)
  }

  const robotPullAccount = await createTeamPullRobotAccount(projectName)
  console.debug(`Creating pull secret/${projectPullSecretName} at ${namespace} namespace`)
  await createK8sSecret({
    namespace,
    name: projectPullSecretName,
    server: `${harborOperator.harborBaseRepoUrl}`,
    username: robotPullAccount.name!,
    password: robotPullAccount.secret!,
  })
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
      server: `${harborOperator.harborBaseRepoUrl}`,
      username: robotPushAccount.name!,
      password: robotPushAccount.secret!,
    })
  }
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
    console.debug(`Creating push secret/${projectBuildPushSecretName} at ${namespace} namespace`)
    await createBuildsK8sSecret({
      namespace,
      name: projectBuildPushSecretName,
      server: `${harborOperator.harborBaseRepoUrl}`,
      username: robotBuildsPushAccount.name!,
      password: robotBuildsPushAccount.secret!,
    })
  }
}

async function setupHarbor() {
  console.log('harborOperator', harborOperator)
  if (!harborOperator.harborBaseUrl) return
  const harborHealthUrl = `${harborOperator.harborBaseUrl}/api/v2.0/systeminfo`
  // harborHealthUrl is an in-cluster http svc, so no multiple external dns confirmations are needed
  await waitTillAvailable(harborHealthUrl, undefined, { confirmations: 1 })
  const bearerAuth = await getBearerToken()
  robotApi.setDefaultAuthentication(bearerAuth)
  configureApi.setDefaultAuthentication(bearerAuth)
  projectsApi.setDefaultAuthentication(bearerAuth)
  memberApi.setDefaultAuthentication(bearerAuth)

  await doApiCall(errors, 'Putting Harbor configuration', () => configureApi.configurationsPut(config))
  await Promise.all(
    harborOperator.teamIds.map(async (teamId: string) => {
      const projectName = `team-${teamId}`
      const teamNamespce = projectName
      const projectReq: ProjectReq = {
        projectName,
      }
      await doApiCall(errors, `Creating project for team ${teamId}`, () => projectsApi.createProject(projectReq))

      const project = await doApiCall(errors, `Get project for team ${teamId}`, () =>
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
          groupName: 'team-admin',
          groupType: HarborGroupType.http,
        },
      }
      await doApiCall(
        errors,
        `Associating "developer" role for team "${teamId}" with harbor project "${projectName}"`,
        () => memberApi.createProjectMember(projectId, undefined, undefined, projMember),
      )
      await doApiCall(
        errors,
        `Associating "project-admin" role for "team-admin" with harbor project "${projectName}"`,
        () => memberApi.createProjectMember(projectId, undefined, undefined, projAdminMember),
      )

      await ensureTeamPullRobotAccountSecret(teamNamespce, projectName)
      await ensureTeamPushRobotAccountSecret(teamNamespce, projectName)
      await ensureTeamBuildPushRobotAccountSecret(teamNamespce, projectName)

      return null
    }),
  )

  handleErrors(errors)
}
