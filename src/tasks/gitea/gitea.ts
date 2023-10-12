import {
  CreateOrgOption,
  CreateRepoOption,
  CreateTeamOption,
  EditRepoOption,
  OrganizationApi,
  Repository,
  RepositoryApi,
  Team,
} from '@redkubes/gitea-client-node'
import { doApiCall, waitTillAvailable } from '../../utils'
import { GITEA_PASSWORD, GITEA_URL, OTOMI_VALUES, cleanEnv } from '../../validators'
import { orgName, otomiValuesRepoName, teamNameViewer, username } from '../common'

const env = cleanEnv({
  GITEA_PASSWORD,
  GITEA_URL,
  OTOMI_VALUES,
})

const teamConfig = env.OTOMI_VALUES.teamConfig ?? {}
const teamIds = Object.keys(teamConfig)
const isMultitenant = !!env.OTOMI_VALUES.otomi?.isMultitenant
const hasArgo = !!env.OTOMI_VALUES.apps?.argocd?.enabled

const errors: string[] = []

const readOnlyTeam: CreateTeamOption = {
  ...new CreateTeamOption(),
  canCreateOrgRepo: false,
  name: teamNameViewer,
  includesAllRepositories: false,
  permission: CreateTeamOption.PermissionEnum.Read,
  units: ['repo.code'],
}

const editorTeam: CreateTeamOption = {
  ...readOnlyTeam,
  includesAllRepositories: false,
  permission: CreateTeamOption.PermissionEnum.Write,
}

const adminTeam: CreateTeamOption = { ...editorTeam, permission: CreateTeamOption.PermissionEnum.Admin }

export async function upsertTeam(
  existingTeams: Team[] = [],
  orgApi: OrganizationApi,
  teamOption: CreateTeamOption,
): Promise<void> {
  const existingTeam = existingTeams.find((el) => el.name === teamOption.name)
  if (existingTeam)
    return doApiCall(
      errors,
      `Updating team "${teamOption.name}" in org "${orgName}"`,
      () => orgApi.orgEditTeam(existingTeam.id!, teamOption),
      422,
    )
  return doApiCall(
    errors,
    `Updating team "${teamOption.name}" in org "${orgName}"`,
    () => orgApi.orgCreateTeam(orgName, teamOption),
    422,
  )
}

export async function upsertRepo(
  existingTeams: Team[] = [],
  existingRepos: Repository[] = [],
  orgApi: OrganizationApi,
  repoApi: RepositoryApi,
  repoOption: CreateRepoOption | EditRepoOption,
  teamName?: string,
): Promise<void> {
  const existingRepo = existingRepos.find((el) => el.name === repoOption.name)
  if (!existingRepo) {
    // org repo create
    await doApiCall(
      errors,
      `Creating repo "${repoOption.name}" in org "${orgName}"`,
      () => orgApi.createOrgRepo(orgName, repoOption as CreateRepoOption),
      422,
    )
  } else {
    // repo update
    await doApiCall(
      errors,
      `Updating repo "${repoOption.name}" in org "${orgName}"`,
      () => repoApi.repoEdit(orgName, repoOption.name!, repoOption as EditRepoOption),
      422,
    )
  }
  // new team repo, add team
  if (teamName)
    await doApiCall(
      errors,
      `Adding repo "${repoOption.name}" to team "${teamName}"`,
      () => repoApi.repoAddTeam(orgName, repoOption.name!, teamName),
      422,
    )
  return undefined
}

export default async function main(): Promise<void> {
  await waitTillAvailable(env.GITEA_URL)

  let giteaUrl = env.GITEA_URL
  if (giteaUrl.endsWith('/')) {
    giteaUrl = giteaUrl.slice(0, -1)
  }

  // create the org
  const orgApi = new OrganizationApi(username, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)
  const repoApi = new RepositoryApi(username, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)
  const orgOption = { ...new CreateOrgOption(), username: orgName, repoAdminChangeTeamAccess: true }
  await doApiCall(errors, `Creating org "${orgName}"`, () => orgApi.orgCreate(orgOption), 422)

  const existingTeams = await doApiCall(errors, `Getting all teams in org "${orgName}"`, () =>
    orgApi.orgListTeams(orgName),
  )
  // create all the teams first
  await Promise.all(
    teamIds.map((teamId) => {
      // determine self service flags
      const name = `team-${teamId}`
      if ((teamConfig[teamId]?.selfService?.apps || []).includes('gitea'))
        return upsertTeam(existingTeams, orgApi, { ...adminTeam, name })
      return upsertTeam(existingTeams, orgApi, { ...editorTeam, name })
    }),
  )
  // create org wide viewer team for otomi role "team-viewer"
  await upsertTeam(existingTeams, orgApi, readOnlyTeam)
  // create the org repo
  const repoOption: CreateRepoOption = {
    ...new CreateRepoOption(),
    autoInit: false,
    name: otomiValuesRepoName,
    _private: true,
  }

  const existingRepos = await doApiCall(errors, `Getting all repos in org "${orgName}"`, () =>
    orgApi.orgListRepos(orgName),
  )

  // create main org repo: otomi/values
  await upsertRepo(existingTeams, existingRepos, orgApi, repoApi, repoOption)

  // add repo: otomi/values to the team: otomi-viewer
  await doApiCall(
    errors,
    `Adding repo values to team otomi-viewer`,
    () => repoApi.repoAddTeam(orgName, 'values', 'otomi-viewer'),
    422,
  )

  if (!hasArgo) return

  // then create initial gitops repo for teams
  await Promise.all(
    teamIds.map(async (teamId) => {
      const name = `team-${teamId}-argocd`
      const option = { ...repoOption, autoInit: true, name }
      // const existingTeamRepos = await doApiCall(
      //   errors,
      //   `Getting all repos from team "${teamId}"`,
      //   () => orgApi.orgListTeamRepos(teamId),
      //   404,
      // )
      return upsertRepo(existingTeams, existingRepos, orgApi, repoApi, option, `team-${teamId}`)
    }),
  )
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
