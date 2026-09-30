import { MemberApi, Project, ProjectApi, ProjectMember, ProjectReq } from '@linode/harbor-client-fetch'
import { debug, error, log } from 'console'
import { HARBOR_GROUP_TYPE, HARBOR_ROLE } from '../consts'
import { errors } from '../globals'
import { alreadyExistsError, notFoundError } from '../helpers'

async function createHarborProject(
  projectName: string,
  projectsApi: ProjectApi,
  projectReq: ProjectReq,
): Promise<Project | null> {
  try {
    debug(`Creating project for team ${projectName}`)
    // Harbor responds 201 without a body, so read the project back to get its id
    await projectsApi.createProject({ project: projectReq })
    return await projectsApi.getProject({ projectNameOrId: projectName })
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
    const existingMembers = await memberApi.listProjectMembers({ projectNameOrId: projectId, entityname: projectName })
    if (existingMembers.length > 0) {
      const [existingMember] = existingMembers
      if (!existingMember.id) {
        errors.push(`Error processing existing member for team ${projectName}: missing member ID`)
        return
      }
      await memberApi.updateProjectMember({
        projectNameOrId: projectId,
        mid: existingMember.id,
        role: { roleId: projMember.roleId },
      })
    } else {
      log(`Associating "developer" role for team "${projectName}" with harbor project "${projectName}"`)
      await memberApi.createProjectMember({ projectNameOrId: projectId, projectMember: projMember })
    }
  } catch (e) {
    if (!alreadyExistsError(e)) {
      errors.push(`Error associating developer role for team ${projectName}: ${e}`)
    }
  }
}

async function ensureProject(
  projectsApi: ProjectApi,
  projectName: string,
  projectReq: ProjectReq,
): Promise<Project | null> {
  let project: Project | null = {}
  try {
    project = await projectsApi.getProject({ projectNameOrId: projectName })
    await projectsApi.updateProject({ projectNameOrId: projectName, project: projectReq })
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

    if (!project?.projectId) return null
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
