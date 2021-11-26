import { waitTillAvailable } from '../../utils'
import { cleanEnv, WAIT_OPTIONS, WAIT_URL } from '../../validators'

const env = cleanEnv({ WAIT_OPTIONS, WAIT_URL })

if (typeof require !== 'undefined' && require.main === module) {
  waitTillAvailable(env.WAIT_URL, env.WAIT_OPTIONS)
}
