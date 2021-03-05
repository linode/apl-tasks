import { RepositoryApi, CreateRepoOption } from '@redkubes/gitea-client-node'

import { cleanEnv, GITEA_USER, GITEA_PASSWORD, GITEA_URL, GITEA_REPO } from '../../validators'

const env = cleanEnv({
  GITEA_USER,
  GITEA_PASSWORD,
  GITEA_URL,
  GITEA_REPO,
})

function main() {
  const hasRepo = new RepositoryApi(env.GITEA_USER, env.GITEA_PASSWORD, `${env.GITEA_URL}/api/v1`)
  hasRepo
    .repoGet(env.GITEA_USER, env.GITEA_REPO)
    .then(() => {
      console.log(`'${env.GITEA_REPO}'-repository already exists, not creating`)
    })
    .catch(() => {
      const body = new CreateRepoOption()
      body.autoInit = false
      body.name = env.GITEA_REPO
      hasRepo
        .createCurrentUserRepo(body)
        .then(() => {
          console.log(`'${env.GITEA_REPO}'-repository has been created`)
        })
        .catch(() => {
          console.error(`Something went wrong when creating '${env.GITEA_REPO}'-repository`)
          process.exit(1)
        })
    })
}
main()
