import { CreateTeamOption, OrganizationApi, Team } from '@linode/gitea-client-fetch'
import { orgName } from '../../../common'
import { isUnprocessableError } from '../helpers'
import { errors } from '../globals'
import { adminTeam, readOnlyTeam } from '../types/teams'

export async function createTeams(teamIds: string[], orgApi: OrganizationApi) {
  await Promise.all(
    teamIds.map((teamId) => {
      const name = `team-${teamId}`
      return upsertTeam(orgApi, orgName, { ...adminTeam, name })
    }),
  )
  // create organization wide viewer team for otomi role "team-viewer"
  await upsertTeam(orgApi, orgName, readOnlyTeam)
}

async function upsertTeam(
  orgApi: OrganizationApi,
  organizationName: string,
  teamOption: CreateTeamOption,
): Promise<void> {
  const getErrors: string[] = []
  let existingTeams: Team[]
  try {
    console.info(`Getting all teams in organization "${organizationName}"`)
    existingTeams = await orgApi.orgListTeams({ org: organizationName })
  } catch (e) {
    getErrors.push(`Error getting all teams in organization "${organizationName}": ${e}`)
    console.error('Errors when getting teams.', getErrors)
    return
  }
  const existingTeam = existingTeams?.find((team) => team.name === teamOption.name)
  if (existingTeam === undefined) {
    try {
      console.info(`Creating team "${teamOption.name}" in organization "${organizationName}"`)
      await orgApi.orgCreateTeam({ org: organizationName, body: teamOption })
    } catch (e) {
      if (!isUnprocessableError(e)) {
        errors.push(`Error creating team "${teamOption.name}" in organization "${organizationName}": ${e}`)
      }
    }
  } else {
    try {
      console.info(`Updating team "${teamOption.name}" in organization "${organizationName}"`)
      await orgApi.orgEditTeam({ id: existingTeam.id!, body: teamOption })
    } catch (e) {
      if (!isUnprocessableError(e)) {
        errors.push(`Error updating team "${teamOption.name}" in organization "${organizationName}": ${e}`)
      }
    }
  }
}
