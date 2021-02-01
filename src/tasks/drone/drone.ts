import * as drone from 'drone-node'
import { cleanEnv, DRONE_CONFIG_PATH, DRONE_URL, DRONE_TOKEN, DRONE_REPO, DRONE_OWNER } from '../../validators'
const env = cleanEnv({
  DRONE_CONFIG_PATH,
  DRONE_URL,
  DRONE_TOKEN,
  DRONE_REPO,
  DRONE_OWNER,
})

const client = new drone.Client({
  url: env.DRONE_URL,
  token: env.DRONE_TOKEN,
})

const settings = {
  // eslint-disable-next-line @typescript-eslint/camelcase
  config_path: env.DRONE_CONFIG_PATH,
}

const errors = []

async function doApiCall(action: string, fn: () => Promise<void>, update = false): Promise<boolean> {
  console.info(`${action}`)
  try {
    await fn()
    console.info(`${action}: SUCCESS!`)
    return true
  } catch (e) {
    errors.push(`Error during '${action}':`, e)
    return false
  }
}

async function main() {
  // first two steps are not working, and drone discourse mentions only real users being able to do this:
  // https://discourse.drone.io/t/not-found-from-machine-user/7073/4?u=morriz

  // Sync repos
  // await doApiCall('Syncing repos', async () => {
  //   await client.syncRepos()
  // })

  // Connect repo
  // await doApiCall('Connecting repo', async () => {
  //   await client.enableRepo(env.DRONE_OWNER, env.DRONE_REPO)
  // })

  // Update repo: this preconfigures the repo so that it only needs activating
  await doApiCall('Updating repo', async () => {
    await client.updateRepo(env.DRONE_OWNER, env.DRONE_REPO, settings)
  })

  // check errors and exit
  if (errors.length) {
    console.error(JSON.stringify(errors, null, 2))
    console.log('Exiting!')
    process.exit(1)
  } else {
    console.info('Success!')
  }
}

main()
