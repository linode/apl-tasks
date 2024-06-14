/* eslint-disable no-param-reassign */
/* eslint-disable no-return-assign */
import { bool, cleanEnv as clean, json, num, str, StrictCleanOptions, url, ValidatorSpec } from 'envalid'

const { env } = process

// const arrString: ValidatorSpec<string[]> = makeValidator((x) => {
//   return JSON.parse(x) as string[]
// })

// START feature toggles determine default value requirements of env vars below
export const FEAT_EXTERNAL_IDP = bool({
  desc: 'Determines wether configuration for an external IDP was provided',
  default: false,
})
const feat = cleanEnv({ FEAT_EXTERNAL_IDP })
// END

export const CERT_ROTATION_DAYS = num({ desc: 'The amount of days for the cert rotation', default: 75 })
export const DOMAINS = json({ desc: 'A list of domains and their cert status' })
export const HARBOR_BASE_URL = str({ desc: 'The harbor core service URL' })
export const HARBOR_BASE_URL_PORT = str({ desc: 'The harbor core service URL port' })
export const HARBOR_BASE_REPO_URL = str({ desc: 'The harbor repository base URL' })
export const HARBOR_OPERATOR_NAMESPACE = str({ desc: 'The harbor operator namespace' })
export const HARBOR_SYSTEM_NAMESPACE = str({ desc: 'The harbor system namespace' })
export const HARBOR_PASSWORD = str({ desc: 'The harbor admin password' })
export const HARBOR_USER = str({ desc: 'The harbor admin username' })
export const IDP_ALIAS = str({ desc: 'An alias for the IDP', default: 'otomi-idp' })
export const IDP_CLIENT_ID = str({ desc: 'The tenant client id' })
export const IDP_CLIENT_SECRET = str({ desc: 'The tenant client secret' })
export const IDP_GROUP_MAPPINGS_TEAMS = json({
  desc: 'A list of team names mapping to group IDs from the IDP',
  default: undefined,
})
export const IDP_GROUP_TEAM_ADMIN = str({ desc: 'Otomi team-admin group name' })
export const IDP_GROUP_OTOMI_ADMIN = str({ desc: 'Otomi admin group name', default: undefined })
export const IDP_OIDC_URL = str({ desc: "The IDP's OIDC enpoints url", default: undefined })
export const IDP_USERNAME_CLAIM_MAPPER = str({
  desc: "The IDP's OIDC claim to username mapper string",
  // eslint-disable-next-line no-template-curly-in-string
  default: '${CLAIM.upn}',
})
export const IDP_SUB_CLAIM_MAPPER = str({
  desc: "The IDP's OIDC claim to sub mapper",
  default: 'sub',
})

export const DRONE_NAMESPACE = str({ desc: 'The namespace of the drone release', default: 'drone' })
export const DRONE_TOKEN = str({ desc: 'The admin token to use for drone api server' })
export const DRONE_URL = str({ desc: 'The public url of the drone server' })
export const GITEA_PASSWORD = str({ desc: 'The gitea admin password' })
export const GITEA_URL = url({ desc: 'The gitea core service url' })
export const KC_HOSTNAME_URL = str({ desc: 'The Keycloak Server address' })
export const KEYCLOAK_ADDRESS_INTERNAL = str({ desc: 'The internal Keycloak kubernetes svc address' })
export const KEYCLOAK_ADMIN = str({ desc: 'Default admin username for KeyCloak Server', default: 'admin' })
export const KEYCLOAK_ADMIN_PASSWORD = str({ desc: 'Default password for admin' })
export const KEYCLOAK_CLIENT_ID = str({ desc: 'Default Keycloak Client', default: 'otomi' })
export const KEYCLOAK_CLIENT_SECRET = str({ desc: 'The keycloak client secret' })
export const KEYCLOAK_REALM = str({ desc: 'The Keycloak Realm', default: 'master' })
export const KEYCLOAK_THEME_LOGIN = str({ desc: 'The Keycloak login theme', default: 'default' })
export const KEYCLOAK_TOKEN_TTL = num({
  desc: 'The Keycloak access token TTL in seconds, 28800 seconds = 8 hours',
  default: 28800,
})
export const KEYCLOAK_TOKEN_OFFLINE_TTL = num({
  desc: 'The Keycloak offline access token TTL in seconds, 604800 seconds = 7 days',
  default: 604800,
})
export const KEYCLOAK_TOKEN_OFFLINE_MAX_TTL_ENABLED = bool({
  desc: 'Allows the Keycloak access token TTL to have max limit for offline use',
  default: true,
})
export const NODE_EXTRA_CA_CERTS = str({ default: undefined })
export const NODE_TLS_REJECT_UNAUTHORIZED = bool({ default: true })
export const OIDC_CLIENT_SECRET = str({ desc: 'The OIDC client secret used by keycloak to access the IDP' })
export const OIDC_ENDPOINT = str({ desc: 'The OIDC endpoint used by keycloak to access the IDP' })
export const OIDC_VERIFY_CERT = bool({ desc: 'Wether to validate the OIDC endpoint cert', default: true })
export const OIDC_USER_CLAIM = str({ desc: 'Claim name containing username values', default: 'email' })
export const OIDC_AUTO_ONBOARD = bool({ desc: 'Wether users should be automatically onboarded', default: true })
export const OTOMI_VALUES = json({ desc: 'The main values such as cluster.* otomi.* teamConfig.*', default: {} })
export const OTOMI_SCHEMA_PATH = str({ desc: 'The path to the values-schema.yaml schema file' })
export const OTOMI_ENV_DIR = str({ desc: 'The path to the otomi-values folder' })
export const OTOMI_FLAGS = json({ default: '{}' })
export const REDIRECT_URIS = json({ desc: "A list of redirect URI's in JSON format" })
export const REGION = str({ desc: 'The cloud region' })
export const SECRETS_NAMESPACE = str({ desc: 'The namespace of the TLS secrets', default: 'istio-system' })
export const TEAM_IDS = json({ desc: 'A list of team ids in JSON format', default: [] })
export const WAIT_URL = str({ desc: 'The URL to wait for.' })
export const WAIT_HOST = str({ desc: 'The HOST header that goes with the url to wait for.', default: undefined })
export const WAIT_OPTIONS = json({ desc: 'The waitTillAvailable options', default: '{}' })

// set default to undefined based on feature flags:
if (!feat.FEAT_EXTERNAL_IDP) {
  ;[
    IDP_ALIAS,
    IDP_GROUP_TEAM_ADMIN,
    IDP_GROUP_OTOMI_ADMIN,
    IDP_OIDC_URL,
    IDP_USERNAME_CLAIM_MAPPER,
    IDP_SUB_CLAIM_MAPPER,
    OIDC_CLIENT_SECRET,
    OIDC_ENDPOINT,
    OIDC_VERIFY_CERT,
    IDP_CLIENT_ID,
    IDP_CLIENT_SECRET,
  ].map((f) => (f.default = undefined))
}

// export env
export function cleanEnv<T>(
  validators: { [K in keyof T]: ValidatorSpec<T[K]> },
  options: StrictCleanOptions = { strict: true },
): any {
  // skip loading local .env in test context, and instead load the sample env
  if (process.env.NODE_ENV === 'test') options.dotEnvPath = '.env.sample'
  return clean(env, validators, options) as any
}

// And to avoid npm trying to check for updates
process.env.NO_UPDATE_NOTIFIER = 'true'
