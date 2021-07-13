import { OrganizationApi, AdminApi, User, Team } from '@redkubes/gitea-client-node'
import { doApiCall, faultTolerantFetch } from '../../utils'
import { cleanEnv, GITEA_PASSWORD, GITEA_URL } from '../../validators'
import { orgName, teamNameOwners, username } from '../common'

const env = cleanEnv({
  GITEA_PASSWORD,
  GITEA_URL,
})
const errors: string[] = []
export default async function main(): Promise<void> {
  await faultTolerantFetch(env.GITEA_URL)
  let giteaUrl = env.GITEA_URL
  if (giteaUrl.endsWith('/')) {
    giteaUrl = giteaUrl.slice(0, -1)
  }
  // create the org
  const adminApi = new AdminApi(username, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)

  const users: User[] = await doApiCall(errors, `Get all users`, () => adminApi.adminGetAllUsers())

  const orgApi = new OrganizationApi(username, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)
  await Promise.allSettled(
    [teamNameOwners].map(
      async (teamName): Promise<any[]> => {
        const orgTeams = (await doApiCall(errors, 'Find team ID if exists', () =>
          orgApi.orgListTeams(orgName),
        )) as Team[]
        const teamID = orgTeams.find((team) => team.name === teamName)!.id as number

        const membersInTeam = (await doApiCall(errors, 'Find all members in this team', () =>
          orgApi.orgListTeamMembers(teamID),
        )) as User[]
        const userIDsInTeam = membersInTeam.map((member) => member.id)
        const membersNotInTeam: User[] = users.filter((user) => !userIDsInTeam.includes(user.id))

        // eslint-disable-next-line no-restricted-syntax
        return Promise.allSettled(
          membersNotInTeam.map((member) =>
            doApiCall(errors, `Add ${member.login} to ${teamName}`, () =>
              orgApi.orgAddTeamMember(teamID, member.login as string),
            ),
          ),
        )
      },
    ),
  )

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
