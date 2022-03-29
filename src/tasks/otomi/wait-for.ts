import { waitTillAvailable } from '../../utils'
import { cleanEnv, WAIT_OPTIONS, WAIT_URL, WAIT_HOST } from '../../validators'

const env = cleanEnv({ WAIT_OPTIONS, WAIT_URL, WAIT_HOST })

if (typeof require !== 'undefined' && require.main === module) {
  waitTillAvailable(env.WAIT_URL, env.WAIT_HOST, env.WAIT_OPTIONS)
}
