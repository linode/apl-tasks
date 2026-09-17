import { CreateRepoOption, EditRepoOption, Repository, RepositoryApi } from '@linode/gitea-client-fetch'
import { orgName, otomiValuesRepoName } from '../../../common'
import { isEmpty } from 'lodash'

export async function createReposAndAddToTeam(
  repoApi: RepositoryApi,
  existingRepos: Repository[],
  repoOption: CreateRepoOption,
) {
  // otomi/values is no longer created by the operator, only kept up to date if it already exists
  const existingValuesRepo = existingRepos.find((repo) => repo.name === otomiValuesRepoName)
  if (isEmpty(existingValuesRepo)) {
    console.info(`Repo "${otomiValuesRepoName}" does not exist, skipping creation`)
    return
  }

  console.info(`Updating repo "${otomiValuesRepoName}" in organization "${orgName}"`)
  await repoApi.repoEdit({ owner: orgName, repo: otomiValuesRepoName, body: repoOption as EditRepoOption })
}
