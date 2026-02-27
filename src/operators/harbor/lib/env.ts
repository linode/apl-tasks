import dotenv from 'dotenv'
import { cleanEnv, str } from 'envalid'

export const HARBOR_BASE_URL = str({ desc: 'The harbor core service URL' })
export const HARBOR_BASE_URL_PORT = str({ desc: 'The harbor core service URL port' })
export const HARBOR_BASE_REPO_URL = str({ desc: 'The harbor repository base URL' })
export const HARBOR_OPERATOR_NAMESPACE = str({ desc: 'The harbor operator namespace' })
export const HARBOR_SYSTEM_NAMESPACE = str({ desc: 'The harbor system namespace' })
export const HARBOR_SYSTEM_ROBOTNAME = str({ desc: 'The harbor system robot account name', default: 'harbor' })
export const HARBOR_PASSWORD = str({ desc: 'The harbor admin password' })
export const HARBOR_USER = str({ desc: 'The harbor admin username' })

export const harborEnvValidators = {
  HARBOR_BASE_URL,
  HARBOR_BASE_URL_PORT,
  HARBOR_OPERATOR_NAMESPACE,
  HARBOR_SYSTEM_NAMESPACE,
  HARBOR_SYSTEM_ROBOTNAME,
}

if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: '.env.harbor.sample' })
} else {
  dotenv.config()
}
export const env = cleanEnv(process.env, harborEnvValidators)
