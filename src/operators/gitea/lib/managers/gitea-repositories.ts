import {
  CreateRepoOption,
  EditRepoOption,
  OrganizationApi,
  Repository,
  RepositoryApi,
} from '@linode/gitea-client-fetch'
import { orgName, otomiChartsRepoName, otomiValuesRepoName, teamNameViewer } from '../../../common'
import { isNotFoundError, isUnprocessableError } from '../helpers'
import { errors } from '../globals'
import { isEmpty } from 'lodash'

export async function createReposAndAddToTeam(
  orgApi: OrganizationApi,
  repoApi: RepositoryApi,
  existingRepos: Repository[],
  repoOption: CreateRepoOption,
) {
  // create main organization repo: otomi/values
  await upsertRepo(existingRepos, orgApi, repoApi, repoOption)
  // create otomi/charts repo for auto image updates
  await upsertRepo(existingRepos, orgApi, repoApi, { ...repoOption, name: otomiChartsRepoName })

  // add repo: otomi/values to the team: otomi-viewer
  const existingValuesRepo = existingRepos.find((repo) => repo.name === otomiValuesRepoName)
  const existingChartsRepo = existingRepos.find((repo) => repo.name === otomiChartsRepoName)
  if (!existingValuesRepo) {
    try {
      console.info(`Adding repo "${otomiValuesRepoName}" to team "${teamNameViewer}"`)
      await repoApi.repoAddTeam({ owner: orgName, repo: otomiValuesRepoName, team: teamNameViewer })
    } catch (e) {
      if (!isUnprocessableError(e)) {
        errors.push(`Error adding repo ${otomiValuesRepoName} to team ${teamNameViewer}: ${e}`)
      }
    }
  }
  if (!existingChartsRepo) {
    // add repo: otomi/charts to the team: otomi-viewer
    try {
      console.info(`Adding repo "${otomiChartsRepoName}" to team "${teamNameViewer}"`)
      await repoApi.repoAddTeam({ owner: orgName, repo: otomiChartsRepoName, team: teamNameViewer })
    } catch (e) {
      if (!isUnprocessableError(e)) {
        errors.push(`Error adding repo ${otomiChartsRepoName} to team ${teamNameViewer}: ${e}`)
      }
    }
  }
}

export async function upsertRepo(
  existingReposInOrg: Repository[] = [],
  orgApi: OrganizationApi,
  repoApi: RepositoryApi,
  repoOption: CreateRepoOption | EditRepoOption,
  teamName?: string,
): Promise<void> {
  const repoName = repoOption.name!
  const existingRepo = existingReposInOrg.find((repository) => repository.name === repoName)
  let addTeam = false
  if (isEmpty(existingRepo)) {
    // organization repo create
    console.info(`Creating repo "${repoName}" in organization "${orgName}"`)
    await orgApi.createOrgRepo({ org: orgName, body: repoOption as CreateRepoOption })
    addTeam = true
  } else {
    // repo update
    console.info(`Updating repo "${repoName}" in organization "${orgName}"`)
    await repoApi.repoEdit({ owner: orgName, repo: repoName, body: repoOption as EditRepoOption })
    if (teamName) {
      console.info(`Checking if repo "${repoName}" is assigned to team "${teamName}"`)
      try {
        await repoApi.repoCheckTeam({ owner: orgName, repo: repoName, team: teamName })
      } catch (error) {
        if (isNotFoundError(error)) {
          addTeam = true
        } else {
          throw error
        }
      }
    }
  }
  if (addTeam && teamName) {
    console.info(`Adding repo "${repoName}" to team "${teamName}"`)
    await repoApi.repoAddTeam({ owner: orgName, repo: repoName, team: teamName })
  }
}
