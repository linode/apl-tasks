import { RepositoryApi, CreateRepoOption } from '@redkubes/gitea-client-node'

import { cleanEnv, GITEA_USER, GITEA_PASSWORD, GITEA_URL, GITEA_REPO } from '../../validators'

const env = cleanEnv({
  GITEA_USER,
  GITEA_PASSWORD,
  GITEA_URL,
  GITEA_REPO,
})

async function main() {
  const hasRepo = new RepositoryApi(env.GITEA_USER, env.GITEA_PASSWORD, `${env.GITEA_URL}/api/v1`)

  try {
    await hasRepo.repoGet(env.GITEA_USER, env.GITEA_REPO)
    console.log(`'${env.GITEA_REPO}'-repository already exists, not creating`)
    process.exit(1)
  } catch (e) {
    console.log(`'${env.GITEA_REPO}'-repository does not exists, creating`)
  }
  const body = new CreateRepoOption()
  body.autoInit = false
  body.name = env.GITEA_REPO
  try {
    await hasRepo.createCurrentUserRepo(body)
    console.log(`'${env.GITEA_REPO}'-repository has been created`)
  } catch (e) {
    console.error(`Something went wrong when creating '${env.GITEA_REPO}'-repository`)
    process.exit(1)
  }
}
main()
