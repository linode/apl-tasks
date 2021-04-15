import { str, bool, json, cleanEnv as clean, CleanEnv, StrictCleanOptions, ValidatorSpec, num, url } from 'envalid'

export const CERT_ROTATION_DAYS = num({ desc: 'The amount of days for the cert rotation', default: 75 })
export const DOMAINS = json({ desc: 'A list of domains and their cert status' })
export const HARBOR_BASE_URL = str({ desc: 'The harbor core service URL' })
export const HARBOR_PASSWORD = str({ desc: 'The harbor admin password' })
export const HARBOR_USER = str({ desc: 'The harbor admin username' })
export const IDP_ALIAS = str({ desc: 'An alias for the IDP' })
export const IDP_GROUP_MAPPINGS_TEAMS = json({ desc: 'A list of team names mapping to group IDs from the IDP' })
export const IDP_GROUP_TEAM_ADMIN = str({ desc: 'Otomi team-admin group name' })
export const IDP_GROUP_OTOMI_ADMIN = str({ desc: 'Otomi admin group name' })
export const IDP_OIDC_URL = str({ desc: "The IDP's OIDC enpoints url" })
export const IDP_USERNAME_CLAIM_MAPPER = str({
  desc: "The IDP's OIDC claim to username mapper string",
  // eslint-disable-next-line no-template-curly-in-string
  default: '${CLAIM.email}',
})
export const IDP_SUB_CLAIM_MAPPER = str({
  desc: "The IDP's OIDC claim to sub mapper",
  default: 'sub',
})

export const KEYCLOAK_ADDRESS = str({ desc: 'The Keycloak Server address' })
export const KEYCLOAK_ADMIN = str({ desc: 'Default admin username for KeyCloak Server' })
export const KEYCLOAK_ADMIN_PASSWORD = str({ desc: 'Default password for admin' })
export const KEYCLOAK_CLIENT_ID = str({ desc: 'Default Keycloak Client', default: 'otomi' })
export const KEYCLOAK_CLIENT_SECRET = str({ desc: 'The keycloak client secret' })
export const KEYCLOAK_REALM = str({ desc: 'The Keycloak Realm', default: 'master' })
export const KEYCLOAK_THEME_LOGIN = str({ desc: 'The Keycloak login theme', default: 'default' })
export const OIDC_CLIENT_SECRET = str()
export const OIDC_ENDPOINT = str()
export const OIDC_SCOPE = str({ desc: 'Name of the default OIDC client scope', default: 'openid email groups' })
export const OIDC_VERIFY_CERT = bool()
export const REDIRECT_URIS = json({ desc: "A list of redirect URI's in JSON format" })
export const REGION = str({ desc: 'The cloud region' })
export const TEAM_NAMES = json({ desc: 'A list of team names in JSON format' })
export const TENANT_CLIENT_ID = str({ desc: 'The tenant client id' })
export const SECRETS_NAMESPACE = str({ desc: 'The namespace of the TLS secrets', default: 'istio-system' })
export const TENANT_CLIENT_SECRET = str({ desc: 'The tenant client secret' })
export const TENANT_ID = str({ desc: 'The tenant ID' })
// Gitea task vars
export const GITEA_USER = str({ desc: 'The gitea admin username' })
export const GITEA_PASSWORD = str({ desc: 'The gitea admin password' })
export const GITEA_URL = url({ desc: 'The gitea core service url' })
export const DRONE_URL = url({ desc: 'The drone core service url' })
export const GITEA_REPO = str({ desc: 'The gitea repo where values will be stored' })

const { env } = process
export function cleanEnv<T>(
  validators: { [K in keyof T]: ValidatorSpec<T[K]> },
  options: StrictCleanOptions = { strict: true },
): Readonly<T> & CleanEnv & { readonly [varName: string]: string | undefined } {
  if (env.NODE_ENV === 'test')
    return process.env as Readonly<T> & CleanEnv & { readonly [varName: string]: string | undefined }
  return clean(env, validators, options) as Readonly<T> & CleanEnv & { readonly [varName: string]: string | undefined }
}
