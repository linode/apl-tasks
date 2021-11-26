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
} from '@redkubes/harbor-client-node'
import { createPullSecret, createSecret, getSecret, k8s } from '../../k8s'
import { doApiCall, handleErrors, waitTillAvailable } from '../../utils'
import {
  cleanEnv,
  HARBOR_BASE_REPO_URL,
  HARBOR_BASE_URL,
  HARBOR_PASSWORD,
  HARBOR_USER,
  OIDC_CLIENT_SECRET,
  OIDC_ENDPOINT,
  OIDC_VERIFY_CERT,
  TEAM_IDS,
} from '../../validators'

const env = cleanEnv({
  HARBOR_BASE_URL,
  HARBOR_BASE_REPO_URL,
  HARBOR_PASSWORD,
  HARBOR_USER,
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
  project_creation_restriction: 'adminonly',
  robot_name_prefix: robotPrefix,
  self_registration: false,
}

const systemNamespace = 'harbor'
const systemSecretName = 'harbor-robot-admin'
const projectSecretName = 'harbor-pullsecret'
const harborBaseUrl = `${env.HARBOR_BASE_URL}/api/v2.0`
const harborHealthUrl = `${harborBaseUrl}/systeminfo`
const robotApi = new RobotApi(env.HARBOR_USER, env.HARBOR_PASSWORD, harborBaseUrl)
const configureApi = new ConfigureApi(env.HARBOR_USER, env.HARBOR_PASSWORD, harborBaseUrl)
const projectsApi = new ProjectApi(env.HARBOR_USER, env.HARBOR_PASSWORD, harborBaseUrl)
const memberApi = new MemberApi(env.HARBOR_USER, env.HARBOR_PASSWORD, harborBaseUrl)

/**
 * Create Harbor robot account that is used by Otomi tasks
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
  await createSecret(systemSecretName, systemNamespace, {
    id: robotAccount.id!,
    name: robotAccount.name!,
    secret: robotAccount.secret!,
  })
  return robotSecret
}

/**
 * Create Harbor system robot account that is scoped to a given Harbor project
 * @param projectName Harbor project name
 */
async function createTeamRobotAccount(projectName: string): Promise<RobotCreated> {
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

  const { body: robotList } = await robotApi.listRobot()
  const existing = robotList.find((i) => i.name === fullName)

  if (existing?.id) {
    const existingId = existing.id
    await doApiCall(errors, `Deleting previous robot account ${fullName}`, () => robotApi.deleteRobot(existingId))
  }

  const robotAccount = (await doApiCall(errors, `Creating robot account ${fullName} with project level perms`, () =>
    robotApi.createRobot(projectRobot),
  )) as RobotCreated
  return robotAccount
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
      robotApi.listRobot()
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
async function ensureTeamRobotAccountSecret(namespace: string, projectName): Promise<void> {
  const k8sSecret = await getSecret(projectSecretName, namespace)
  if (k8sSecret) {
    console.debug(`Deleting secret/${projectSecretName} from ${namespace} namespace`)
    await k8s.core().deleteNamespacedSecret(projectSecretName, namespace)
  }

  const robotAccount = await createTeamRobotAccount(projectName)
  console.debug(`Creating secret/${projectSecretName} at ${namespace} namespace`)
  await createPullSecret({
    namespace,
    name: projectSecretName,
    server: `${env.HARBOR_BASE_REPO_URL}`,
    username: robotAccount.name!,
    password: robotAccount.secret!,
  })
}

async function main(): Promise<void> {
  // harborHealthUrl is an in-cluster http svc, so no multiple external dns confirmations are needed
  await waitTillAvailable(harborHealthUrl, { confirmations: 1 })
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

      await ensureTeamRobotAccountSecret(teamNamespce, projectName)

      return null
    }),
  )

  handleErrors(errors)
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
