import {
  OrganizationApi,
  // CreateRepoOption,
  // CreateOrgOption,
  // CreateTeamOption,
  AdminApi,
  User,
  Team,
} from '@redkubes/gitea-client-node'
import { doApiCall } from '../../utils'
import { cleanEnv, GITEA_PASSWORD, GITEA_URL } from '../../validators'
import {
  createTeam,
  orgName,
  teamName,
  // orgName,
  // teamName,
  // repoName,
  username,
} from './common'

const env = cleanEnv({
  GITEA_PASSWORD,
  GITEA_URL,
})
const errors: string[] = []
export default async function main(): Promise<void> {
  let giteaUrl = env.GITEA_URL
  if (giteaUrl.endsWith('/')) {
    giteaUrl = giteaUrl.slice(0, -1)
  }
  // create the org
  const adminApi = new AdminApi(username, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)

  const users: User[] = await doApiCall(errors, `Get all users`, () => adminApi.adminGetAllUsers())

  const orgApi = new OrganizationApi(username, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)
  let teams = ((await doApiCall(errors, 'Find team ID if exists', () =>
    orgApi.orgListTeams(orgName),
  )) as Team[]).filter((team) => team.name === teamName)
  if (teams.length === 0) {
    teams = [await createTeam(errors, orgApi)]
  }
  const teamID: number = teams.map((team) => team.id)[0] as number

  const membersInTeam: User[] = (await doApiCall(errors, 'Find all members in this team', () =>
    orgApi.orgListTeamMembers(teamID),
  )) as User[]
  const userIDsInTeam = membersInTeam.map((member) => member.id)

  const membersNotInTeam: User[] = users.filter((user) => !userIDsInTeam.includes(user.id))
  const promises: Promise<any>[] = []
  // eslint-disable-next-line no-restricted-syntax
  for (const member of membersNotInTeam) {
    promises.push(
      doApiCall(errors, `Add ${member.login} to ${teamName}`, () =>
        orgApi.orgAddTeamMember(teamID, member.login as string),
      ),
    )
  }
  Promise.allSettled(promises)

  if (errors.length) {
    console.error(`Errors found: ${JSON.stringify(errors, null, 2)}`)
    process.exit(1)
  } else {
    console.info('Success!')
  }
}
// Run main only on execution, not on import (like tests)
if (typeof require !== 'undefined' && require.main === module) {
  main()
}
