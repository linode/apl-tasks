import axios from 'axios'

export const defaultsIdpMapperTpl = (alias: string) => {
  return [
    {
      name: 'upn to email',
      identityProviderAlias: alias,
      identityProviderMapper: 'oidc-user-attribute-idp-mapper',
      config: {
        syncMode: 'INHERIT',
        claim: 'upn',
        'user.attribute': 'email',
      },
    },
    {
      name: 'username mapping',
      identityProviderAlias: alias,
      identityProviderMapper: 'oidc-username-idp-mapper',
      config: {
        template: '${CLAIM.given_name} ${CLAIM.family_name}',
        syncMode: 'INHERIT',
      },
    },
  ]
}

export const idpMapperTpl = (name: string, alias: string, role: string, claim: string) => {
  return {
    name: name,
    identityProviderAlias: alias,
    identityProviderMapper: 'oidc-role-idp-mapper',
    config: {
      syncMode: 'INHERIT',
      claim: 'groups',
      role: role,
      'claim.value': claim,
    },
  }
}

export const clientScopeCfgTpl = (protocolMappers: object) => {
  return {
    name: 'openid',
    protocol: 'openid-connect',
    attributes: {
      'include.in.token.scope': 'true',
      'display.on.consent.screen': 'true',
    },
    protocolMappers: protocolMappers,
  }
}

export const protocolMappersList = [
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

export const roleTpl = (name: string, groupMapping: string, containerId: string) => {
  return {
    name: name,
    description: `Mapped for incoming IDP GROUP_ID: ${groupMapping}`,
    composite: false,
    clientRole: false,
    containerId: containerId,
    attributes: {},
  }
}

export const clientEmailClaimMapper = () => {
  return {
    name: "email",
    protocol: "openid-connect",
    protocolMapper: "oidc-usermodel-property-mapper",
    consentRequired: false,
    config: {
      "userinfo.token.claim": "true",
      "user.attribute": "email",
      "id.token.claim": "true",
      "access.token.claim": "true",
      "claim.name": "email",
      "jsonType.label": "String"
    }
  }
}

function oidcCfg(providerCfg: OidcProviderCfg, tenantId: string, clientId: string, clientSecret: string) {
  return {
    userInfoUrl: providerCfg.userinfo_endpoint,
    validateSignature: 'true',
    clientId: clientId,
    tokenUrl: providerCfg.token_endpoint,
    jwksUrl: providerCfg.jwks_uri,
    issuer: providerCfg.issuer,
    useJwksUrl: `true`,
    authorizationUrl: providerCfg.authorization_endpoint,
    clientAuthMethod: `client_secret_post`,
    logoutUrl: providerCfg.end_session_endpoint,
    syncMode: 'FORCE',
    clientSecret: clientSecret,
    defaultScope: 'openid email profile',
  }
}

async function getDiscoveryUrls(oidcUrl: string, version = 'v2.0') {
  return await axios.get(`${oidcUrl}/${version}/.well-known/openid-configuration`).then((response) => {
    if (!response.data) throw Error('Oidc Provider Address not found!')
    return response.data
  })
}

export const idpProviderCfgTpl = async (
  alias: string,
  tenantId: string,
  clientId: string,
  clientSecret: string,
  oidcUrl: string,
) => {
  // currently tested only on Azure AD
  const oidcCfgObj = await getDiscoveryUrls(oidcUrl)
  return {
    alias: alias,
    displayName: alias,
    providerId: 'oidc',
    enabled: true,
    trustEmail: true,
    firstBrokerLoginFlowAlias: 'first broker login',
    config: oidcCfg(oidcCfgObj as OidcProviderCfg, tenantId, clientId, clientSecret),
  }
}

export const otomiClientCfgTpl = (secret: string, redirectUris: object) => {
  return {
    id: 'otomi',
    secret: secret,
    defaultClientScopes: [
      'openid',
      'email',
      'profile',
    ],
    redirectUris: redirectUris,
    standardFlowEnabled: true,
    implicitFlowEnabled: true,
    directAccessGrantsEnabled: true,
    serviceAccountsEnabled: true,
    authorizationServicesEnabled: true,
  }
}

//type definition for imported ENV variable IDP_GROUP_MAPPINGS_TEAMS
export type TeamMapping = {
  name: string
  groupMapping: string
}

//type definition for OIDC Discovery URI Object Metadata
export type OidcProviderCfg = {
  jwks_uri: string
  token_endpoint: string
  issuer: string
  userinfo_endpoint: string
  authorization_endpoint: string
  end_session_endpoint: string
}
