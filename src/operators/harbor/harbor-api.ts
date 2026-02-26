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
import { error, log, warn } from 'console'
import { HarborGroupType, HarborRole } from './const'
import { HarborConfigMapData, HarborSecretData, RobotAccountRef } from './types'

type RobotSpec = Pick<RobotCreate, 'name' | 'description' | 'disable' | 'level' | 'duration' | 'permissions'>

export class HarborConfig {
  harborBaseRepoUrl: string
  harborUser: string
  harborPassword: string
  oidcClientId: string
  oidcClientSecret: string
  oidcEndpoint: string
  oidcVerifyCert: boolean
  oidcUserClaim: string
  oidcAutoOnboard: boolean
  oidcGroupsClaim: string
  oidcName: string
  oidcScope: string
  teamNamespaces: string[]

  constructor(secretData: HarborSecretData, configMapData: HarborConfigMapData) {
    this.harborBaseRepoUrl = configMapData.harborBaseRepoUrl
    this.harborUser = secretData.harborUser
    this.harborPassword = secretData.harborPassword
    this.oidcClientId = secretData.oidcClientId
    this.oidcClientSecret = secretData.oidcClientSecret
    this.oidcEndpoint = secretData.oidcEndpoint
    this.oidcVerifyCert = configMapData.oidcVerifyCert
    this.oidcUserClaim = configMapData.oidcUserClaim
    this.oidcAutoOnboard = configMapData.oidcAutoOnboard
    this.oidcGroupsClaim = configMapData.oidcGroupsClaim
    this.oidcName = configMapData.oidcName
    this.oidcScope = configMapData.oidcScope
    this.teamNamespaces = configMapData.teamNamespaces ?? []
  }
}

export interface HarborApis {
  robotApi: RobotApi
  configureApi: ConfigureApi
  projectsApi: ProjectApi
  memberApi: MemberApi
}

export interface HarborApiCredentials {
  harborUser: string
  harborPassword: string
  harborBaseUrl: string
  bearerAuth: HttpBearerAuth
}

export interface HarborConfigurationInput {
  oidcClientSecret: string
  oidcEndpoint: string
  oidcVerifyCert: boolean
  oidcUserClaim: string
  oidcAutoOnboard: boolean
}

export function createHarborApis(credentials: HarborApiCredentials): HarborApis {
  const { harborUser, harborPassword, harborBaseUrl, bearerAuth } = credentials
  const robotApi = new RobotApi(harborUser, harborPassword, harborBaseUrl)
  const configureApi = new ConfigureApi(harborUser, harborPassword, harborBaseUrl)
  const projectsApi = new ProjectApi(harborUser, harborPassword, harborBaseUrl)
  const memberApi = new MemberApi(harborUser, harborPassword, harborBaseUrl)

  robotApi.setDefaultAuthentication(bearerAuth)
  configureApi.setDefaultAuthentication(bearerAuth)
  projectsApi.setDefaultAuthentication(bearerAuth)
  memberApi.setDefaultAuthentication(bearerAuth)

  return {
    robotApi,
    configureApi,
    projectsApi,
    memberApi,
  }
}

export async function applyHarborConfiguration(
  configureApi: ConfigureApi,
  desiredConfig: HarborConfigurationInput,
  robotPrefix: string,
): Promise<void> {
  const config: Configurations = {
    authMode: 'oidc_auth',
    oidcAdminGroup: 'platform-admin',
    oidcClientId: 'otomi',
    oidcClientSecret: desiredConfig.oidcClientSecret,
    oidcEndpoint: desiredConfig.oidcEndpoint,
    oidcGroupsClaim: 'groups',
    oidcName: 'otomi',
    oidcScope: 'openid',
    oidcVerifyCert: desiredConfig.oidcVerifyCert,
    oidcUserClaim: desiredConfig.oidcUserClaim,
    oidcAutoOnboard: desiredConfig.oidcAutoOnboard,
    projectCreationRestriction: 'adminonly',
    robotNamePrefix: robotPrefix,
    selfRegistration: false,
    primaryAuthMode: true,
  }

  await configureApi.updateConfigurations(config)
}

function handleApiError(errors: string[], action: string, e: unknown, statusCodeExists = 409): void {
  const err = e as {
    statusCode?: number
    message?: string
    body?: unknown
  }
  warn(err.body ?? `${String(err)}`)
  if (err.statusCode) {
    if (err.statusCode === statusCodeExists) {
      warn(`${action} > already exists.`)
    } else {
      errors.push(`${action} > HTTP error ${err.statusCode}: ${err.message}`)
    }
  } else {
    errors.push(`${action} > Unknown error: ${err?.message ?? String(err)}`)
  }
}

async function updateRobotToken(
  robotApi: RobotApi,
  errors: string[],
  robotId: number,
  robotName: string,
  spec: RobotSpec,
  token: string,
): Promise<void> {
  const action = `Updating robot token for ${robotName}`
  log(action)
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
  try {
    await robotApi.updateRobot(robotId, robotUpdate)
  } catch (e) {
    handleApiError(errors, action, e)
  }
}

export async function upsertRobotAccountWithToken(
  robotApi: RobotApi,
  errors: string[],
  robotPrefix: string,
  spec: RobotSpec,
  token: string,
): Promise<RobotAccountRef> {
  const fullName = `${robotPrefix}${spec.name}`
  const listAction = `Listing robot accounts for ${fullName}`
  log(listAction)
  let robotList: Array<Pick<Robot, 'id' | 'name'>> = []
  try {
    const listRes = await robotApi.listRobot(undefined, undefined, undefined, undefined, 100)
    robotList = (listRes.body ?? []) as Array<Pick<Robot, 'id' | 'name'>>
  } catch (e) {
    handleApiError(errors, listAction, e)
  }
  const existing = robotList.find((i) => i.name === fullName)

  if (existing?.id) {
    await updateRobotToken(robotApi, errors, existing.id, fullName, spec, token)
    return { id: existing.id, name: fullName }
  }

  const createAction = `Creating robot account ${fullName}`
  log(createAction)
  let robotAccount: RobotCreated | undefined
  try {
    const createRes = await robotApi.createRobot({ ...spec, secret: token })
    robotAccount = createRes.body
  } catch (e) {
    handleApiError(errors, createAction, e)
  }
  if (!robotAccount?.id) {
    throw new Error(
      `RobotAccount already exists and should have been created beforehand. This happens when more than 100 robot accounts exist.`,
    )
  }
  await updateRobotToken(robotApi, errors, robotAccount.id, fullName, spec, token)
  return { id: robotAccount.id, name: fullName }
}

export async function assignMembersToProject(projectId: string): Promise<void> {}

export async function processHarborProject(
  apis: HarborApis,
  errors: string[],
  namespace: string,
): Promise<null | string> {
  try {
    const projectName = namespace
    const projectReq: ProjectReq = {
      projectName,
    }
    const createProjectAction = `Creating project for team ${namespace}`
    log(createProjectAction)
    try {
      await apis.projectsApi.createProject(projectReq)
    } catch (e) {
      handleApiError(errors, createProjectAction, e)
    }

    const getProjectAction = `Get project for team ${namespace}`
    log(getProjectAction)
    let project: { projectId?: number | string } | undefined
    try {
      const projectRes = await apis.projectsApi.getProject(projectName)
      project = projectRes.body as { projectId?: number | string } | undefined
    } catch (e) {
      handleApiError(errors, getProjectAction, e)
      project = undefined
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
    const devRoleAction = `Associating "developer" role for team "${namespace}" with harbor project "${projectName}"`
    log(devRoleAction)
    try {
      await apis.memberApi.createProjectMember(projectId, undefined, undefined, projMember)
    } catch (e) {
      handleApiError(errors, devRoleAction, e)
    }
    const adminRoleAction = `Associating "project-admin" role for "all-teams-admin" with harbor project "${projectName}"`
    log(adminRoleAction)
    try {
      await apis.memberApi.createProjectMember(projectId, undefined, undefined, projAdminMember)
    } catch (e) {
      handleApiError(errors, adminRoleAction, e)
    }

    log(`Successfully processed namespace: ${namespace}`)
    return null
  } catch (e) {
    error(`Error processing namespace ${namespace}:`, e)
    return null
  }
}
