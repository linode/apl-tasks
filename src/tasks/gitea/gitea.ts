import { CreateOrgOption, CreateRepoOption, CreateTeamOption, OrganizationApi } from '@redkubes/gitea-client-node'
import { doApiCall, waitTillAvailable } from '../../utils'
import { cleanEnv, GITEA_PASSWORD, GITEA_URL } from '../../validators'
import { orgName, repoName, teamNameViewer, username } from '../common'

const env = cleanEnv({
  GITEA_PASSWORD,
  GITEA_URL,
})
const errors: string[] = []

export async function createTeam(orgApi: OrganizationApi): Promise<void> {
  const readOnlyTeam: CreateTeamOption = {
    ...new CreateTeamOption(),
    canCreateOrgRepo: false,
    name: teamNameViewer,
    includesAllRepositories: true,
    permission: CreateTeamOption.PermissionEnum.Read,
    units: ['repo.code'],
  }
  return doApiCall(
    errors,
    `Creating team "${teamNameViewer}" in org "${orgName}"`,
    () => orgApi.orgCreateTeam(orgName, readOnlyTeam),
    422,
  )
}

export default async function main(): Promise<void> {
  await waitTillAvailable(env.GITEA_URL)

  let giteaUrl = env.GITEA_URL
  if (giteaUrl.endsWith('/')) {
    giteaUrl = giteaUrl.slice(0, -1)
  }

  // create the org
  const orgApi = new OrganizationApi(username, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)
  const orgOption = { ...new CreateOrgOption(), username: orgName, repoAdminChangeTeamAccess: true }
  await doApiCall(errors, `Creating org "${orgName}"`, () => orgApi.orgCreate(orgOption), 422)

  // await createTeam(orgApi)
  // create the org repo
  const repoOption = { ...new CreateRepoOption(), autoInit: false, name: repoName, _private: true }
  await doApiCall(errors, `Creating org repo "${repoName}"`, () => orgApi.createOrgRepo(orgName, repoOption))
  // add the
  if (errors.length) {
    console.error(`Errors found: ${JSON.stringify(errors, null, 2)}`)
    process.exit(1)
  } else {
    console.info('Success!')
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
