import { ProtocolMapperRepresentation } from '@linode/keycloak-client-node'
import axios from 'axios'
import { emailTransformer } from '../../utils'
import { cleanEnv, KEYCLOAK_CLIENT_ID } from '../../validators'

export const keycloakRealm = 'otomi'

const localEnv = cleanEnv({
  KEYCLOAK_CLIENT_ID,
})

export const defaultsIdpMapperTpl = (
  idpAlias: string,
  idpUsernameClaimMapper: string,
  idpSubClaimMapper: string,
): Array<Record<string, unknown>> => [
  {
    name: 'upn to email',
    identityProviderAlias: idpAlias,
    identityProviderMapper: 'oidc-user-attribute-idp-mapper',
    config: {
      syncMode: 'INHERIT',
      claim: 'upn',
      'user.attribute': 'email',
    },
  },
  {
    name: 'username mapping',
    identityProviderAlias: idpAlias,
    identityProviderMapper: 'oidc-username-idp-mapper',
    config: {
      template: idpUsernameClaimMapper,
      syncMode: 'INHERIT',
    },
  },
  {
    name: 'sub',
    identityProviderAlias: idpAlias,
    identityProviderMapper: 'oidc-user-attribute-idp-mapper',
    config: {
      syncMode: 'INHERIT',
      claim: idpSubClaimMapper,
      'user.attribute': 'sub',
    },
  },
]

export const idpMapperTpl = (name: string, alias: string, role: string, claim: string): Record<string, unknown> => ({
  name,
  identityProviderAlias: alias,
  identityProviderMapper: 'oidc-role-idp-mapper',
  config: {
    syncMode: 'INHERIT',
    claim: 'groups',
    role,
    'claim.value': claim,
  },
})

export const adminUserCfgTpl = (username: string, password: string): Record<string, unknown> => ({
  username,
  email: 'admin@oto.mi',
  emailVerified: true,
  enabled: true,
  realmRoles: ['platformAdmin'],
  groups: ['platform-admin'],
  credentials: [
    {
      type: 'password',
      value: password,
      temporary: false,
    },
  ],
  requiredActions: [],
})

export const teamUserCfgTpl = (
  email: string,
  firstName: string,
  lastName: string,
  groups: string[],
  initialPassword: string,
): Record<string, unknown> => ({
  username: email,
  enabled: true,
  email,
  emailVerified: true,
  firstName,
  lastName,
  realmRoles: ['teamMember'],
  groups,
  credentials: [
    {
      type: 'password',
      value: `${initialPassword}`,
      temporary: true,
    },
  ],
  requiredActions: [],
  attributes: {
    nickname: [emailTransformer(email)],
  },
})

export const realmCfgTpl = (realm: string): Record<string, unknown> => ({
  id: realm,
  realm,
  displayName: realm,
  displayNameHtml: '<div class="kc-logo-text"><span>APL</span></div>',
  enabled: true,
  sslRequired: 'external',
  loginTheme: 'APL',
  registrationAllowed: false,
  loginWithEmailAllowed: true,
  duplicateEmailsAllowed: false,
  resetPasswordAllowed: true,
  editUsernameAllowed: false,
  bruteForceProtected: true,
})

export const clientScopeCfgTpl = (protocolMappers: ProtocolMapperRepresentation[]): Record<string, unknown> => ({
  name: 'openid',
  protocol: 'openid-connect',
  attributes: {
    'include.in.token.scope': 'true',
    'display.on.consent.screen': 'true',
  },
  protocolMappers,
})

export const protocolMappersList: Array<Record<string, unknown>> = [
  {
    name: 'groups',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-realm-role-mapper',
    consentRequired: false,
    config: {
      multivalued: 'true',
      'userinfo.token.claim': 'true',
      'user.attribute': '',
      'id.token.claim': 'true',
      'access.token.claim': 'true',
      'claim.name': 'groups',
      'jsonType.label': 'String',
    },
  },
  {
    name: 'email',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-property-mapper',
    consentRequired: false,
    config: {
      'userinfo.token.claim': 'true',
      'user.attribute': 'email',
      'id.token.claim': 'true',
      'access.token.claim': 'true',
      'claim.name': 'email',
      'jsonType.label': 'String',
    },
  },
  {
    name: 'realm roles',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-realm-role-mapper',
    consentRequired: false,
    config: {
      'user.attribute': '',
      'access.token.claim': 'true',
      'claim.name': 'realm_access.roles',
      'jsonType.label': 'String',
      multivalued: 'true',
    },
  },
  {
    name: 'client roles',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-client-role-mapper',
    consentRequired: false,
    config: {
      'user.attribute': '',
      'access.token.claim': 'true',
      'claim.name': 'resource_access.${client_id}.roles',
      'jsonType.label': 'String',
      multivalued: 'true',
    },
  },
  {
    name: 'username',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-property-mapper',
    consentRequired: false,
    config: {
      'userinfo.token.claim': 'true',
      'user.attribute': 'username',
      'id.token.claim': 'true',
      'access.token.claim': 'true',
      'claim.name': 'preferred_username',
      'jsonType.label': 'String',
    },
  },
]

export const roleTpl = (name: string, groupMapping: string, containerId: string): Record<string, unknown> => ({
  name,
  description: `Created by APL${groupMapping ? ` - mapped for incoming IDP GROUP_ID: ${groupMapping}` : ''}`,
  composite: false,
  clientRole: false,
  containerId,
  attributes: {},
})

export const clientEmailClaimMapper = (): Record<string, unknown> => ({
  name: 'email',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-usermodel-property-mapper',
  consentRequired: false,
  config: {
    'userinfo.token.claim': 'true',
    'user.attribute': 'email',
    'id.token.claim': 'true',
    'access.token.claim': 'true',
    'claim.name': 'email',
    'jsonType.label': 'String',
  },
})

export const clientSubClaimMapper = (): Record<string, unknown> => ({
  name: 'sub',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-usermodel-property-mapper',
  consentRequired: false,
  config: {
    'access.token.claim': 'true',
    'claim.name': 'sub',
    'id.token.claim': 'true',
    'introspection.token.claim': 'true',
    'jsonType.label': 'String',
    'lightweight.claim': 'true',
    'user.attribute': 'id',
    'userinfo.token.claim': 'true',
  },
})


export const clientNicknameClaimMapper = (): Record<string, unknown> => ({
  name: 'nickname',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-usermodel-attribute-mapper',
  config: {
    'access.token.claim': 'true',
    'claim.name': 'nickname',
    'id.token.claim': 'true',
    'introspection.token.claim': 'true',
    'jsonType.label': 'String',
    'lightweight.claim': 'true',
    'user.attribute': 'nickname',
    'userinfo.token.claim': 'true',
   },
})

export const clientAudClaimMapper = (): Record<string, unknown> => ({
  name: 'aud-mapper-otomi',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-audience-mapper',
  config: {
    'access.token.claim': 'true',
    'id.token.claim': 'true',
    'included.client.audience': localEnv.KEYCLOAK_CLIENT_ID,
    'introspection.token.claim': 'true',
    'lightweight.claim': 'true',
  },
})

export const oidcCfg = (
  providerCfg: OidcProviderCfg,
  clientId: string,
  clientSecret: string,
): Record<string, unknown> => ({
  userInfoUrl: providerCfg.userinfo_endpoint,
  validateSignature: 'true',
  clientId,
  tokenUrl: providerCfg.token_endpoint,
  jwksUrl: providerCfg.jwks_uri,
  issuer: providerCfg.issuer,
  useJwksUrl: `true`,
  authorizationUrl: providerCfg.authorization_endpoint,
  clientAuthMethod: `client_secret_post`,
  logoutUrl: providerCfg.end_session_endpoint,
  syncMode: 'FORCE',
  clientSecret,
  defaultScope: 'openid email profile',
})

export async function getDiscoveryUrls(oidcUrl: string, version = 'v2.0'): Promise<OidcProviderCfg> {
  const response = await axios.get(`${oidcUrl}${version}/.well-known/openid-configuration`)
  if (!response.data) throw Error('Oidc Provider Address not found!')
  return response.data
}

export const idpProviderCfgTpl = async (
  alias: string,
  clientId: string,
  clientSecret: string,
  oidcUrl: string,
): Promise<Record<string, unknown>> => {
  // currently tested only on Azure AD
  const oidcCfgObj = await getDiscoveryUrls(oidcUrl)
  return {
    alias,
    displayName: alias,
    providerId: 'oidc',
    enabled: true,
    trustEmail: true,
    firstBrokerLoginFlowAlias: 'first broker login',
    config: oidcCfg(oidcCfgObj, clientId, clientSecret),
  }
}

export const otomiClientCfgTpl = (
  secret: string,
  redirectUris: string[],
  webOrigins: string[],
): Record<string, unknown> => ({
  id: 'otomi',
  secret,
  defaultClientScopes: ['openid', 'email', 'profile'],
  redirectUris,
  standardFlowEnabled: true,
  implicitFlowEnabled: true,
  directAccessGrantsEnabled: true,
  serviceAccountsEnabled: true,
  authorizationServicesEnabled: true,
  webOrigins,
})

// type definition for imported ENV variable IDP_GROUP_MAPPINGS_TEAMS
export type TeamMapping = {
  name: string
  groupMapping: string
}

// type definition for OIDC Discovery URI Object Metadata
export type OidcProviderCfg = {
  jwks_uri: string
  token_endpoint: string
  issuer: string
  userinfo_endpoint: string
  authorization_endpoint: string
  end_session_endpoint: string
}
