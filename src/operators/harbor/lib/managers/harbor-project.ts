import { MemberApi, Project, ProjectApi, ProjectMember, ProjectReq } from '@linode/harbor-client-node'
import { debug, error, log } from 'console'
import { HARBOR_GROUP_TYPE, HARBOR_ROLE } from '../consts'
import { errors } from '../globals'
import { alreadyExistsError } from '../helpers'

function notFoundError(e): boolean {
  if (e && e.body && e.body.errors && e.body.errors.length > 0) {
    return e.body.errors[0].message.includes('not found')
  }
  return true
}

async function createHarborProject(projectName: string, projectsApi: ProjectApi, projectReq: ProjectReq): Promise<any> {
  try {
    debug(`Creating project for team ${projectName}`)
    const response = await projectsApi.createProject(projectReq)
    return response.body
  } catch (e) {
    if (!alreadyExistsError(e)) errors.push(`Error creating project for team ${projectName}: ${e}`)
    return null
  }
}

const ALL_TEAMS_ADMIN = 'all-teams-admin'

async function ensureProjectMember(
  memberApi: MemberApi,
  projectId: string,
  projectName: string,
  projMember: ProjectMember,
): Promise<void> {
  try {
    const response = await memberApi.listProjectMembers(
      projectId,
      undefined,
      undefined,
      undefined,
      undefined,
      projectName,
    )
    const existingMembers = response.body
    if (existingMembers.length > 0) {
      const [existingMember] = existingMembers
      if (!existingMember.id) {
        errors.push(`Error processing existing member for team ${projectName}: missing member ID`)
        return
      }
      await memberApi.updateProjectMember(projectId, existingMember.id, undefined, undefined, projMember)
    } else {
      log(`Associating "developer" role for team "${projectName}" with harbor project "${projectName}"`)
      await memberApi.createProjectMember(projectId, undefined, undefined, projMember)
    }
  } catch (e) {
    if (!alreadyExistsError(e)) {
      errors.push(`Error associating developer role for team ${projectName}: ${e}`)
    }
  }
}

async function ensureProject(projectsApi: ProjectApi, projectName: string, projectReq: ProjectReq): Promise<Project> {
  let project: Project = {}
  try {
    project = (await projectsApi.getProject(projectName)).body
    await projectsApi.updateProject(projectName, projectReq)
  } catch (e) {
    if (notFoundError(e)) {
      project = await createHarborProject(projectName, projectsApi, projectReq)
    } else {
      errors.push(`Error getting project for team ${projectName}: ${e}`)
    }
  }
  return project
}

export default async function manageHarborProject(
  projectName: string,
  projectsApi: ProjectApi,
  memberApi: MemberApi,
): Promise<string | null> {
  try {
    const projectReq: ProjectReq = {
      projectName,
    }
    const project = await ensureProject(projectsApi, projectName, projectReq)

    if (!project.projectId) return null
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
        groupName: ALL_TEAMS_ADMIN,
        groupType: HARBOR_GROUP_TYPE.http,
      },
    }
    await ensureProjectMember(memberApi, projectId, projectName, projMember)
    await ensureProjectMember(memberApi, projectId, ALL_TEAMS_ADMIN, projAdminMember)

    log(`Successfully processed project: ${projectName}`)
    return projectId
  } catch (e) {
    error(`Error processing project ${projectName}:`, e)
    return null
  }
}
