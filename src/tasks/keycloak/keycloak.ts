/* eslint-disable @typescript-eslint/camelcase */
import { Issuer, TokenSet } from 'openid-client'
import {
  ClientsApi,
  IdentityProvidersApi,
  ClientScopesApi,
  RolesApi,
  ProtocolMappersApi,
  RealmsAdminApi,
  IdentityProviderMapperRepresentation,
  IdentityProviderRepresentation,
  ClientScopeRepresentation,
  ClientRepresentation,
  ProtocolMapperRepresentation,
} from '@redkubes/keycloak-client-node'
import * as realmConfig from './realm-factory'
import {
  cleanEnv,
  IDP_ALIAS,
  KEYCLOAK_ADMIN,
  KEYCLOAK_ADMIN_PASSWORD,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
} from '../../validators'

import { faultTolerantFetch, doApiCall, ensure, handleErrors } from '../../utils'

const env = cleanEnv({
  IDP_ALIAS,
  KEYCLOAK_ADMIN,
  KEYCLOAK_ADMIN_PASSWORD,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
})

const errors: string[] = []

async function main(): Promise<void> {
  await faultTolerantFetch(env.KEYCLOAK_ADDRESS)

  let basePath
  let token: TokenSet
  try {
    const keycloakAddress = env.KEYCLOAK_ADDRESS
    const keycloakRealm = env.KEYCLOAK_REALM
    basePath = `${keycloakAddress}/admin/realms`
    const keycloakIssuer = await Issuer.discover(`${keycloakAddress}/realms/${keycloakRealm}/`)
    const openIdConnectClient = new keycloakIssuer.Client({
      client_id: 'admin-cli',
      client_secret: 'unused',
    })
    token = await openIdConnectClient.grant({
      grant_type: 'password',
      username: env.KEYCLOAK_ADMIN,
      password: env.KEYCLOAK_ADMIN_PASSWORD,
    })
  } catch (error) {
    console.error(error)
    console.info('Exiting!')
    process.exit(1)
  }

  // Configure AccessToken for service calls
  const providers = new IdentityProvidersApi(basePath)
  providers.accessToken = String(token.access_token)
  const clientScope = new ClientScopesApi(basePath)
  clientScope.accessToken = String(token.access_token)
  const roles = new RolesApi(basePath)
  roles.accessToken = String(token.access_token)
  const clients = new ClientsApi(basePath)
  clients.accessToken = String(token.access_token)
  const protocols = new ProtocolMappersApi(basePath)
  protocols.accessToken = String(token.access_token)
  const realms = new RealmsAdminApi(basePath)
  realms.accessToken = String(token.access_token)

  // Create Client Scopes
  const scope = realmConfig.createClientScopes()

  const clientScopes = (await doApiCall(errors, 'Getting openid client scope', () =>
    clientScope.realmClientScopesGet(env.KEYCLOAK_REALM),
  )) as Array<ClientScopeRepresentation>
  const existingScope = clientScopes.find((el) => el.name === scope.name)
  if (existingScope) {
    await doApiCall(errors, 'Updating openid client scope', async () => {
      // @NOTE this PUT operation is almost pointless as it is not updating deep nested properties because of various db constraints
      return clientScope.realmClientScopesIdPut(env.KEYCLOAK_REALM, existingScope.id!, scope)
    })
  } else {
    await doApiCall(errors, 'Creating openid client scope', () =>
      clientScope.realmClientScopesPost(env.KEYCLOAK_REALM, scope),
    )
  }

  // Create Roles
  const teamRoles = realmConfig.mapTeamsToRoles()
  interface RealmRole {
    name: string
  }
  const existingRoles = (await doApiCall(errors, `Getting all roles from realm ${env.KEYCLOAK_REALM}`, async () =>
    roles.realmRolesGet(env.KEYCLOAK_REALM),
  )) as Array<RealmRole>

  await Promise.all(
    teamRoles.map((role) => {
      const exists = existingRoles.some((el) => el.name === role.name!)
      if (exists) {
        return doApiCall(errors, `Updating role ${role.name!}`, async () =>
          roles.realmRolesRoleNamePut(env.KEYCLOAK_REALM, role.name ?? '', role),
        )
      }
      return doApiCall(errors, `Creating role ${role.name!}`, async () =>
        roles.realmRolesPost(env.KEYCLOAK_REALM, role),
      )
    }),
  )

  // Create Identity Provider
  const idp = await realmConfig.createIdProvider()

  const existingProviders = (await doApiCall(errors, 'Geting identity provider', async () => {
    return providers.realmIdentityProviderInstancesGet(env.KEYCLOAK_REALM)
  })) as Array<IdentityProviderRepresentation>

  if (existingProviders.some((el) => el.alias === idp.alias)) {
    await doApiCall(errors, 'Updating identity provider', async () => {
      return providers.realmIdentityProviderInstancesAliasPut(env.KEYCLOAK_REALM, ensure(idp.alias), idp)
    })
  } else {
    await doApiCall(errors, 'Creating identity provider', async () => {
      return providers.realmIdentityProviderInstancesPost(env.KEYCLOAK_REALM, idp)
    })
  }

  // Create Identity Provider Mappers
  // @NOTE - PUT involves adding strict required properties not in the factory
  const idpMappers = realmConfig.createIdpMappers()

  const existingMappers = (await doApiCall(errors, `Getting role mappers`, () =>
    providers.realmIdentityProviderInstancesAliasMappersGet(env.KEYCLOAK_REALM, env.IDP_ALIAS),
  )) as IdentityProviderMapperRepresentation[]

  await Promise.all(
    idpMappers.map((idpMapper) => {
      const existingMapper: IdentityProviderMapperRepresentation | undefined = (existingMappers || []).find(
        (m) => m.name === idpMapper.name,
      )
      if (existingMapper) {
        return doApiCall(errors, `Updating mapper ${idpMapper.name!}`, () =>
          providers.realmIdentityProviderInstancesAliasMappersIdPut(
            env.KEYCLOAK_REALM,
            env.IDP_ALIAS,
            existingMapper.id!,
            { ...existingMapper, ...idpMapper },
          ),
        )
      }
      return doApiCall(errors, `Creating mapper ${idpMapper.name!}`, () =>
        providers.realmIdentityProviderInstancesAliasMappersPost(env.KEYCLOAK_REALM, env.IDP_ALIAS, idpMapper),
      )
    }),
  )
  // Create Otomi Client
  const client = realmConfig.createClient()
  const allClients = (await doApiCall(errors, 'Getting otomi client', () =>
    clients.realmClientsGet(env.KEYCLOAK_REALM),
  )) as Array<ClientRepresentation>

  if (allClients.some((el) => el.name === client.name)) {
    await doApiCall(errors, 'Updating otomi client', () =>
      clients.realmClientsIdPut(env.KEYCLOAK_REALM, ensure(client.id), client),
    )
  } else {
    await doApiCall(errors, 'Creating otomi client', () => clients.realmClientsPost(env.KEYCLOAK_REALM, client))
  }

  const allClaims = (await doApiCall(errors, 'Getting client email claim', () =>
    protocols.realmClientsIdProtocolMappersModelsGet(env.KEYCLOAK_REALM, ensure(client.id)),
  )) as Array<ProtocolMapperRepresentation>
  const mapper = realmConfig.createClientEmailClaimMapper()
  if (!allClaims.some((el) => el.name === mapper.name)) {
    await doApiCall(errors, 'Creating client email claim mapper', () =>
      protocols.realmClientsIdProtocolMappersModelsPost(env.KEYCLOAK_REALM, ensure(client.id), mapper),
    )
  }

  // set login theme
  await doApiCall(errors, 'adding theme for login page', () =>
    realms.realmPut(env.KEYCLOAK_REALM, realmConfig.createLoginThemeConfig('otomi')),
  )

  handleErrors(errors)
}

// Run main only on execution, not on import (like tests)
if (typeof require !== 'undefined' && require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main()
}
