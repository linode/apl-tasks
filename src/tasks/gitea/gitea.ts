import { OrganizationApi, CreateRepoOption, CreateOrgOption } from '@redkubes/gitea-client-node'
import { doApiCall } from '../../utils'

import { cleanEnv, GITEA_PASSWORD, GITEA_URL } from '../../validators'
import { orgName, repoName, username } from './common'

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
  const orgApi = new OrganizationApi(username, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)
  const orgOption = { ...new CreateOrgOption(), username: orgName, repoAdminChangeTeamAccess: true }
  await doApiCall(errors, `Creating org "${orgName}"`, () => orgApi.orgCreate(orgOption), 422)
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
// Run main only on execution, not on import (like tests)
if (typeof require !== 'undefined' && require.main === module) {
  main()
}
