import {
  ConfigureApi,
  MemberApi,
  HttpBearerAuth,
  ProjectApi,
  ProjectMember,
  ProjectReq,
  RobotApi,
  Robotv1Api,
  Project,
  RobotCreate,
} from '@redkubes/harbor-client-node'

import {
  cleanEnv,
  HARBOR_BASE_URL,
  HARBOR_BASE_REPO_URL,
  HARBOR_PASSWORD,
  HARBOR_USER,
  OIDC_CLIENT_SECRET,
  OIDC_ENDPOINT,
  OIDC_VERIFY_CERT,
  TEAM_IDS,
} from '../../validators'
import {
  createSecret,
  createPullSecret,
  getApiClient,
  getSecret,
  doApiCall,
  handleErrors,
  waitTillAvailable,
} from '../../utils'

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
  self_registration: false,
}

const systemNamespace = 'harbor'
const systemSecretName = 'harbor-robot-admin'
const projectSecretName = 'harbor-pullsecret'
const projectRobotName = 'otomi'
const bearerAuth: HttpBearerAuth = new HttpBearerAuth()
const harborBaseUrl = `${env.HARBOR_BASE_URL}/api/v2.0`
const harborHealthUrl = `${harborBaseUrl}/systeminfo`
const robotApi = new RobotApi(env.HARBOR_USER, env.HARBOR_PASSWORD, harborBaseUrl)
const robotv1Api = new Robotv1Api(env.HARBOR_USER, env.HARBOR_PASSWORD, harborBaseUrl)
const configureApi = new ConfigureApi(env.HARBOR_USER, env.HARBOR_PASSWORD, harborBaseUrl)
const projectsApi = new ProjectApi(env.HARBOR_USER, env.HARBOR_PASSWORD, harborBaseUrl)
const memberApi = new MemberApi(env.HARBOR_USER, env.HARBOR_PASSWORD, harborBaseUrl)

function setAuth(secret): void {
  bearerAuth.accessToken = secret
  robotApi.setDefaultAuthentication(bearerAuth)
}

// NOTE: assumes OIDC is not yet configured, otherwise this operation is NOT possible
async function createSystemRobotSecret(): Promise<RobotSecret> {
  const { body: robotList } = await robotApi.listRobot()
  const existing = robotList.find((i) => i.name === `robot$${systemRobot.name}`)
  if (existing?.id) {
    const existingId = existing.id
    await doApiCall(errors, `Deleting previous robot account ${systemRobot.name}`, () =>
      robotApi.deleteRobot(existingId),
    )
  }
  const { id, name, secret } = await doApiCall(
    errors,
    `Create robot account ${systemRobot.name} with system level perms`,
    () => robotApi.createRobot(systemRobot),
  )
  const robotSecret: RobotSecret = { id, name, secret }
  await createSecret(systemSecretName, systemNamespace, robotSecret)
  return robotSecret
}

async function createProjectRobotSecret(teamId: string, projectId: string): Promise<RobotSecret> {
  const namespace = `team-${teamId}`
  const projectRobot: RobotCreate = {
    name: projectRobotName,
    duration: -1,
    description: 'Created by Otomi for transparent pulling.',
    disable: false,
    level: 'project',
    permissions: [
      {
        kind: 'project',
        namespace,
        access: [
          {
            resource: 'repository',
            action: 'pull',
          },
        ],
      },
    ],
  }

  const { body: robotList } = await robotv1Api.listRobotV1(projectId)
  const existing = robotList.find((i) => i.name === `robot$${namespace}+${projectRobot.name}`)

  if (existing?.id) {
    const existingId = existing.id
    await doApiCall(errors, `Deleting previous robot account ${existing.name}`, () =>
      robotv1Api.deleteRobotV1(projectId, existingId),
    )
  }

  const { id, name, secret } = await doApiCall(
    errors,
    `Create project robot account ${projectRobot.name} with project level perms`,
    // () => robotv1Api.createRobotV1(projectId, projectRobot), // this function didn't work. I couldn't fix the expiration time with this function. I have to use the robotApi
    () => robotApi.createRobot(projectRobot),
  )
  const robotSecret: RobotSecret = { id, name, secret }
  return robotSecret
}

async function ensureSystemSecret(): Promise<RobotSecret> {
  let robotSecret = (await getSecret(systemSecretName, systemNamespace)) as RobotSecret
  if (!robotSecret) {
    // not existing yet, create robot account and keep creds in secret
    robotSecret = await createSystemRobotSecret()
  } else {
    // test if secret still works
    try {
      setAuth(robotSecret.secret)
      robotApi.listRobot()
    } catch (e) {
      // throw everything expect 401, which is what we test for
      if (e.status !== 401) throw e
      // unauthenticated, so remove and recreate secret
      await getApiClient().deleteNamespacedSecret(systemSecretName, systemNamespace)
      // now, the next call might throw IF:
      // - authMode oidc was already turned on and an otomi admin accidentally removed the secret
      // but that is very unlikely, an unresolvable problem and needs a manual db fix
      robotSecret = await createSystemRobotSecret()
    }
  }
  setAuth(robotSecret.secret)
  return robotSecret
}

async function ensureProjectSecret(teamId: string, projectId: string): Promise<void> {
  const namespace = `team-${teamId}`

  let k8sSecret = (await getSecret(projectSecretName, namespace)) as RobotSecret
  if (k8sSecret) {
    await getApiClient().deleteNamespacedSecret(projectSecretName, namespace)
  }

  k8sSecret = await createProjectRobotSecret(teamId, projectId)
  await createPullSecret({
    teamId,
    name: projectSecretName,
    server: `${env.HARBOR_BASE_REPO_URL}`,
    username: `robot$${namespace}+${projectRobotName}`,
    password: k8sSecret.secret,
  })
}

async function main(): Promise<void> {
  await waitTillAvailable(harborHealthUrl)
  await ensureSystemSecret()

  // now we can set the token on our apis
  // too bad we can't set it globally
  configureApi.setDefaultAuthentication(bearerAuth)
  projectsApi.setDefaultAuthentication(bearerAuth)
  memberApi.setDefaultAuthentication(bearerAuth)
  robotv1Api.setDefaultAuthentication(bearerAuth)

  await doApiCall(errors, 'Putting Harbor configuration', () => configureApi.configurationsPut(config))
  await Promise.all(
    env.TEAM_IDS.map(async (teamId: string) => {
      const namespace = `team-${teamId}`
      const projectReq: ProjectReq = {
        projectName: namespace,
      }
      await doApiCall(errors, `Creating project for team ${teamId}`, () => projectsApi.createProject(projectReq))

      const project = (await doApiCall(errors, `Get project for team ${teamId}`, () =>
        projectsApi.getProject(namespace),
      )) as Project
      if (!project) return ''
      const projectId = `${project.projectId}`

      const projMember: ProjectMember = {
        roleId: HarborRole.developer,
        memberGroup: {
          groupName: namespace,
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
      await doApiCall(errors, `Associating "developer" role for team "${teamId}" with harbor project "${teamId}"`, () =>
        memberApi.createProjectMember(projectId, undefined, undefined, projMember),
      )
      await doApiCall(errors, `Associating "project-admin" role for "team-admin" with harbor project "${teamId}"`, () =>
        memberApi.createProjectMember(projectId, undefined, undefined, projAdminMember),
      )

      await ensureProjectSecret(teamId, projectId)

      return null
    }),
  )

  handleErrors(errors)
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
