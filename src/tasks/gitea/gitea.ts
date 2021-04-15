import { RepositoryApi, CreateRepoOption } from '@redkubes/gitea-client-node'

import { cleanEnv, GITEA_PASSWORD, GITEA_URL } from '../../validators'
import { username, repoName, GiteaDroneError } from './common'

const env = cleanEnv({
  GITEA_PASSWORD,
  GITEA_URL,
})

async function main() {
  let giteaUrl = env.GITEA_URL
  if (giteaUrl.endsWith('/')) {
    giteaUrl = giteaUrl.slice(0, -1)
  }

  const repo = new RepositoryApi(username, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)

  try {
    await repo.repoGet(username, repoName)
    console.info(`repo '${repoName}' already exists`)
    process.exit(0)
  } catch (e) {
    if (e.statusCode !== '404') {
      console.error(e)
      throw e
    }
    console.info(`repo '${repoName}' does not exist yet, creating`)
  }
  const body = { ...new CreateRepoOption(), autoInit: false, name: repoName, _private: true }
  try {
    await repo.createCurrentUserRepo(body)
    console.info(`repo '${repoName}' has been created`)
  } catch (e) {
    throw new GiteaDroneError(`Something went wrong when creating repo '${repoName}'`)
  }
}
// Run main only on execution, not on import (like tests)
if (typeof require !== 'undefined' && require.main === module) {
  main()
}
