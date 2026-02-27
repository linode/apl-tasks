import { MemberApi, ProjectApi, ProjectMember, ProjectReq } from '@linode/harbor-client-node'
import { error, log } from 'console'
import { HARBOR_GROUP_TYPE, HARBOR_ROLE } from '../consts'
import { errors } from '../globals'
import { alreadyExistsError } from '../helpers'

export default async function manageHarborProject(
  projectName: string,
  projectsApi: ProjectApi,
  memberApi: MemberApi,
): Promise<string | null> {
  try {
    const projectReq: ProjectReq = {
      projectName,
    }
    try {
      log(`Creating project for team ${projectName}`)
      await projectsApi.createProject(projectReq)
    } catch (e) {
      if (!alreadyExistsError(e)) errors.push(`Error creating project for team ${projectName}: ${e}`)
    }

    let project
    try {
      project = (await projectsApi.getProject(projectName)).body
    } catch (e) {
      errors.push(`Error getting project for team ${projectName}: ${e}`)
    }
    if (!project) return null
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
        groupName: 'all-teams-admin',
        groupType: HARBOR_GROUP_TYPE.http,
      },
    }
    try {
      log(`Associating "developer" role for team "${projectName}" with harbor project "${projectName}"`)
      await memberApi.createProjectMember(projectId, undefined, undefined, projMember)
    } catch (e) {
      if (!alreadyExistsError(e)) errors.push(`Error associating developer role for team ${projectName}: ${e}`)
    }
    try {
      log(`Associating "project-admin" role for "all-teams-admin" with harbor project "${projectName}"`)
      await memberApi.createProjectMember(projectId, undefined, undefined, projAdminMember)
    } catch (e) {
      if (!alreadyExistsError(e)) errors.push(`Error associating project-admin role for all-teams-admin: ${e}`)
    }

    log(`Successfully processed project: ${projectName}`)
    return projectId
  } catch (e) {
    error(`Error processing project ${projectName}:`, e)
    return null
  }
}
