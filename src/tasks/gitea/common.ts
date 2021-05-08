import { CreateTeamOption, OrganizationApi } from '@redkubes/gitea-client-node'
import { CustomError } from 'ts-custom-error'
import { doApiCall } from '../../utils'

export class GiteaDroneError extends CustomError {}
export const orgName = 'otomi'
export const teamName = 'readOnly'
export const repoName = 'values'
export const username = 'otomi-admin'

export async function createTeam(errors: string[], orgApi: OrganizationApi): Promise<any | undefined> {
  const readOnlyTeam: CreateTeamOption = {
    ...new CreateTeamOption(),
    canCreateOrgRepo: false,
    name: teamName,
    includesAllRepositories: true,
    permission: CreateTeamOption.PermissionEnum.Read,
    units: ['repo.code', 'repo.issues', 'repo.ext_issues', 'repo.wiki', 'repo.pulls', 'repo.releases', 'repo.ext_wiki'],
  }
  return doApiCall(errors, `Creating team "${teamName}" in org "${orgName}"`, () =>
    orgApi.orgCreateTeam(orgName, readOnlyTeam),
  )
}
