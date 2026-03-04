import { cleanEnv, num, str } from 'envalid'

export const GITEA_PASSWORD = str({ desc: 'The gitea admin password' })
export const GITEA_USERNAME = str({ desc: 'The gitea username', default: 'otomi-admin' })
export const GITEA_URL = str({ desc: 'The gitea core service url' })
export const GITEA_URL_PORT = str({ desc: 'The gitea core service url port' })
export const GITEA_OPERATOR_NAMESPACE = str({ desc: 'The gitea operator namespace' })
export const CHECK_OIDC_CONFIG_INTERVAL = num({ desc: 'The interval to check the OIDC config in seconds', default: 30 })
export const RETRIES = num({ desc: 'The maximum amount of times to retry a certain function', default: 20 })
export const MIN_TIMEOUT = num({ desc: 'The number of milliseconds before starting the first retry', default: 30000 })

export const giteaEnvValidators = {
  GITEA_URL,
  GITEA_URL_PORT,
  GITEA_OPERATOR_NAMESPACE,
  CHECK_OIDC_CONFIG_INTERVAL,
  RETRIES,
  MIN_TIMEOUT,
  GITEA_USERNAME,
}

export const giteaEnv = cleanEnv(process.env, giteaEnvValidators)
