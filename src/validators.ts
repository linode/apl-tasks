import { str, bool, json, cleanEnv as clean, CleanEnv, StrictCleanOptions, ValidatorSpec, num } from 'envalid'

export const CERT_ROTATION_DAYS = num({ desc: 'The amount of days for the cert rotation', default: 75 })
export const CLUSTER_APISERVER = str({ desc: 'The cluster api server ip/host' })
export const CLUSTER_ID = str({ desc: 'The cluster id', default: 'google/dev' })
export const CLUSTER_NAME = str({ desc: 'The cluster name', default: 'dev' })
export const DB_PATH = str({ desc: 'The file path to the db. If not given in-memory db is used.', default: undefined })
export const DISABLE_SYNC = bool({ desc: 'Wether to disable pushing to the repo', default: false })
export const DOMAINS = json({ desc: 'A list of domains and their cert status' })
export const GIT_BRANCH = str({ desc: 'The git repo branch', default: 'master' })
export const GIT_EMAIL = str({ desc: 'The git user email' })
export const GIT_LOCAL_PATH = str({ desc: 'The local file path to the repo', default: '/tmp/otomi-stack' })
export const GIT_PASSWORD = str({ desc: 'The git password' })
export const GIT_REPO_URL = str({ desc: 'The git repo url', default: 'github.com/redkubes/otomi-values-demo.git' })
export const GIT_USER = str({ desc: 'The git username' })
export const HARBOR_BASE_URL = str({ desc: 'The harbor core service URL' })
export const HARBOR_PASSWORD = str({ desc: 'The harbor admin password' })
export const HARBOR_USER = str({ desc: 'The harbor admin username' })
export const IDP_ALIAS = str({ desc: 'An alias for the IDP' })
export const IDP_GROUP_MAPPINGS_TEAMS = json({ desc: 'A list of team names mapping to group IDs from the IDP' })
export const IDP_GROUP_TEAM_ADMIN = str({ desc: 'Otomi team-admin group name' })
export const IDP_GROUP_OTOMI_ADMIN = str({ desc: 'Otomi admin group name' })
export const IDP_OIDC_URL = str({ desc: "The IDP's OIDC enpoints url" })
export const KEYCLOAK_ADDRESS = str({ desc: 'The Keycloak Server address' })
export const KEYCLOAK_ADMIN = str({ desc: 'Default admin username for KeyCloak Server' })
export const KEYCLOAK_ADMIN_PASSWORD = str({ desc: 'Default password for admin' })
export const KEYCLOAK_CLIENT_ID = str({ desc: 'Default Keycloak Client', default: 'otomi' })

export const KEYCLOAK_CLIENT_SECRET = str({ desc: 'The keycloak client secret' })
export const KEYCLOAK_REALM = str({ desc: 'The Keycloak Realm', default: 'master' })
export const OIDC_CLIENT_SECRET = str()
export const OIDC_ENDPOINT = str()
export const OIDC_VERIFY_CERT = bool()
export const REDIRECT_URIS = json({ desc: "A list of redirect URI's in JSON format" })
export const REGION = str({ desc: 'The cloud region' })
export const TEAM_NAMES = json({ desc: 'A list of team names in JSON format' })
export const TENANT_CLIENT_ID = str({ desc: 'The tenant client id' })
export const SECRETS_NAMESPACE = str({ desc: 'The namespace of the TLS secrets', default: 'istio-system' })
export const TENANT_CLIENT_SECRET = str({ desc: 'The tenant client secret' })
export const TENANT_ID = str({ desc: 'The tenant ID' })
export const TOOLS_HOST = str({ desc: 'The host of the tools server', default: '127.0.0.1' })
export const TEAM_USER = str({ desc: 'The username for team-user', default: 'team.user@redkubes.net' })
export const TEAM_USER_PASSWORD = str({ desc: 'Password for team-user account' })

const env = process.env
export function cleanEnv<T>(
  validators: { [K in keyof T]: ValidatorSpec<T[K]> },
  options: StrictCleanOptions = { strict: true },
): Readonly<T> & CleanEnv & { readonly [varName: string]: string | undefined } {
  if (env.NODE_ENV === 'test')
    return process.env as Readonly<T> & CleanEnv & { readonly [varName: string]: string | undefined }
  else
    return clean(env, validators, options) as Readonly<T> &
      CleanEnv & { readonly [varName: string]: string | undefined }
}
