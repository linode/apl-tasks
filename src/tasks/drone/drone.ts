import * as drone from 'drone-node'
import { doApiCall, handleErrors } from '../../utils'
import { cleanEnv, DRONE_TOKEN, DRONE_URL } from '../../validators'
import { orgName, repoName } from '../common'
import { waitTillAvailable } from '../otomi/wait-for'

const env = cleanEnv({
  DRONE_URL,
  DRONE_TOKEN,
})

const client = new drone.Client({
  url: env.DRONE_URL,
  token: env.DRONE_TOKEN,
})

// const settings = {
//   config_path: env.DRONE_CONFIG_PATH,
// }

const errors: string[] = []

async function main(): Promise<void> {
  await waitTillAvailable(env.DRONE_URL)

  // first two steps are not working, and drone discourse mentions only real users being able to do this:
  // https://discourse.drone.io/t/not-found-from-machine-user/7073/4?u=morriz

  // Sync repos
  // await doApiCall(errors, 'Syncing repos', () => client.syncRepos())

  // Connect repo
  await doApiCall(errors, 'Connecting repo', () => client.enableRepo(orgName, repoName))

  // Update repo: this preconfigures the repo so that it only needs activating
  await doApiCall(errors, 'Updating repo', () => client.updateRepo(orgName, repoName, {}))

  handleErrors(errors)
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
