import { RepositoryApi, CreateRepoOption } from '@redkubes/gitea-client-node'

import { cleanEnv, GITEA_USER, GITEA_PASSWORD, GITEA_URL, GITEA_REPO } from '../../validators'

const env = cleanEnv({
  GITEA_USER,
  GITEA_PASSWORD,
  GITEA_URL,
  GITEA_REPO,
})

async function main() {
  let giteaUrl = env.GITEA_URL
  if (giteaUrl.endsWith('/')) {
    giteaUrl = giteaUrl.slice(0, -1)
  }

  const hasRepo = new RepositoryApi(env.GITEA_USER, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)

  try {
    await hasRepo.repoGet(env.GITEA_USER, env.GITEA_REPO)
    console.log(`'${env.GITEA_REPO}'-repository already exists, not creating`)
    process.exit(0)
  } catch (e) {
    console.log(`'${env.GITEA_REPO}'-repository does not exists, creating`)
  }
  const body = new CreateRepoOption()
  body.autoInit = false
  body.name = env.GITEA_REPO
  body._private = true
  try {
    await hasRepo.createCurrentUserRepo(body)
    console.log(`'${env.GITEA_REPO}'-repository has been created`)
  } catch (e) {
    console.error(`Something went wrong when creating '${env.GITEA_REPO}'-repository`)
    process.exit(1)
  }
}
// Run main only on execution, not on import (like tests)
if (typeof require !== 'undefined' && require.main === module) {
  main()
}
