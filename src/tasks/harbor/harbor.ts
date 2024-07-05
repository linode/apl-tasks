// eslint-disable @typescript-eslint/camelcase

import {
  ConfigureApi,
  HttpBearerAuth,
  MemberApi,
  // eslint-disable-next-line no-unused-vars
  Project,
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
} from '@linode/harbor-client-node'
import { createBuildsK8sSecret, createK8sSecret, createSecret, getSecret, k8s } from '../../k8s'
import { doApiCall, handleErrors, waitTillAvailable } from '../../utils'
import {
  HARBOR_BASE_REPO_URL,
  HARBOR_BASE_URL,
  HARBOR_PASSWORD,
  HARBOR_USER,
  OIDC_AUTO_ONBOARD,
  OIDC_CLIENT_SECRET,
  OIDC_ENDPOINT,
  OIDC_USER_CLAIM,
  OIDC_VERIFY_CERT,
  TEAM_IDS,
  cleanEnv,
} from '../../validators'

const env = cleanEnv({
  HARBOR_BASE_URL,
  HARBOR_BASE_REPO_URL,
  HARBOR_PASSWORD,
  HARBOR_USER,
  OIDC_USER_CLAIM,
  OIDC_AUTO_ONBOARD,
  OIDC_CLIENT_SECRET,
  OIDC_ENDPOINT,
  OIDC_VERIFY_CERT,
  TEAM_IDS,
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

const errors: string[] = []

export interface RobotSecret {
  id: number
  name: string
  secret: string
}

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

const robotPrefix = 'otomi-'
const config: any = {
  auth_mode: 'oidc_auth',
  oidc_admin_group: 'admin',
  oidc_client_id: 'otomi',
  oidc_client_secret: env.OIDC_CLIENT_SECRET,
  oidc_endpoint: env.OIDC_ENDPOINT,
  oidc_groups_claim: 'groups',
  oidc_name: 'otomi',
  oidc_scope: 'openid',
  oidc_verify_cert: env.OIDC_VERIFY_CERT,
  oidc_user_claim: env.OIDC_USER_CLAIM,
  oidc_auto_onboard: env.OIDC_AUTO_ONBOARD,
  project_creation_restriction: 'adminonly',
  robot_name_prefix: robotPrefix,
  self_registration: false,
}

const systemNamespace = 'harbor'
const systemSecretName = 'harbor-robot-admin'
const projectPullSecretName = 'harbor-pullsecret'
const projectPushSecretName = 'harbor-pushsecret'
const projectBuildPushSecretName = 'harbor-pushsecret-builds'
const harborBaseUrl = `${env.HARBOR_BASE_URL}/api/v2.0`
const harborHealthUrl = `${harborBaseUrl}/systeminfo`
const robotApi = new RobotApi(env.HARBOR_USER, env.HARBOR_PASSWORD, harborBaseUrl)
const configureApi = new ConfigureApi(env.HARBOR_USER, env.HARBOR_PASSWORD, harborBaseUrl)
const projectsApi = new ProjectApi(env.HARBOR_USER, env.HARBOR_PASSWORD, harborBaseUrl)
const memberApi = new MemberApi(env.HARBOR_USER, env.HARBOR_PASSWORD, harborBaseUrl)

/**
 * Create Harbor robot account that is used by APL tasks
 * @note assumes OIDC is not yet configured, otherwise this operation is NOT possible
 */
async function createSystemRobotSecret(): Promise<RobotSecret> {
  const { body: robotList } = await robotApi.listRobot()
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
      await k8s.core().deleteNamespacedSecret(systemSecretName, systemNamespace)
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
    await k8s.core().deleteNamespacedSecret(projectPullSecretName, namespace)
  }

  const robotPullAccount = await createTeamPullRobotAccount(projectName)
  console.debug(`Creating pull secret/${projectPullSecretName} at ${namespace} namespace`)
  await createK8sSecret({
    namespace,
    name: projectPullSecretName,
    server: `${env.HARBOR_BASE_REPO_URL}`,
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
      server: `${env.HARBOR_BASE_REPO_URL}`,
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
      server: `${env.HARBOR_BASE_REPO_URL}`,
      username: robotBuildsPushAccount.name!,
      password: robotBuildsPushAccount.secret!,
    })
  }
}

async function main(): Promise<void> {
  // harborHealthUrl is an in-cluster http svc, so no multiple external dns confirmations are needed
  await waitTillAvailable(harborHealthUrl, undefined, { confirmations: 1 })
  const bearerAuth = await getBearerToken()
  robotApi.setDefaultAuthentication(bearerAuth)
  configureApi.setDefaultAuthentication(bearerAuth)
  projectsApi.setDefaultAuthentication(bearerAuth)
  memberApi.setDefaultAuthentication(bearerAuth)

  await doApiCall(errors, 'Putting Harbor configuration', () => configureApi.configurationsPut(config))
  await Promise.all(
    env.TEAM_IDS.map(async (teamId: string) => {
      const projectName = `team-${teamId}`
      const teamNamespce = projectName
      const projectReq: ProjectReq = {
        projectName,
      }
      await doApiCall(errors, `Creating project for team ${teamId}`, () => projectsApi.createProject(projectReq))

      const project = (await doApiCall(errors, `Get project for team ${teamId}`, () =>
        projectsApi.getProject(projectName),
      )) as Project
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

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
