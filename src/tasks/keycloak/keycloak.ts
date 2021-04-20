/* eslint-disable @typescript-eslint/camelcase */
import { Issuer } from 'openid-client'
import {
  ClientsApi,
  IdentityProvidersApi,
  ClientScopesApi,
  RolesApi,
  ProtocolMappersApi,
  RealmsAdminApi,
  IdentityProviderMapperRepresentation,
} from '@redkubes/keycloak-client-node'
import { find } from 'lodash'
import * as realmConfig from './realm-factory'
import {
  cleanEnv,
  IDP_ALIAS,
  KEYCLOAK_ADMIN,
  KEYCLOAK_ADMIN_PASSWORD,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
} from '../../validators'
import { doApiCall, ensure, handleErrors } from '../../utils'

const env = cleanEnv({
  IDP_ALIAS,
  KEYCLOAK_ADMIN,
  KEYCLOAK_ADMIN_PASSWORD,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
})

const errors: string[] = []

async function main(): Promise<void> {
  let basePath
  let token
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
  const clientScopes = !(await doApiCall(errors, 'Creating openid client scope', () =>
    clientScope.realmClientScopesPost(env.KEYCLOAK_REALM, scope),
  ))
  if (clientScopes) {
    // @NOTE this PUT operation is almost pointless as it is not updating deep nested properties because of various db constraints
    await doApiCall(errors, 'Updating openid client scope', async () => {
      const currentClientScopes = await clientScope.realmClientScopesGet(env.KEYCLOAK_REALM)
      const { id } = ensure(find(currentClientScopes.body, { name: scope.name }))
      return clientScope.realmClientScopesIdPut(env.KEYCLOAK_REALM, ensure(id), scope)
    })
  }

  // Create Roles
  const teamRoles = realmConfig.mapTeamsToRoles()
  await Promise.all(
    teamRoles.map(
      async (role): Promise<void> => {
        const exists = await doApiCall(errors, `Creating role ${role.name}`, async () =>
          roles.realmRolesPost(env.KEYCLOAK_REALM, role),
        )
        if (exists)
          await doApiCall(errors, `Updating role ${role.name}`, async () =>
            roles.realmRolesRoleNamePut(env.KEYCLOAK_REALM, role.name ?? '', role),
          )
      },
    ),
  )

  // Create Identity Provider
  const idp = await realmConfig.createIdProvider()
  const idpExists = await doApiCall(errors, 'Creating identity provider', async () => {
    return providers.realmIdentityProviderInstancesPost(env.KEYCLOAK_REALM, idp)
  })
  if (idpExists) {
    await doApiCall(errors, 'Updating identity provider', async () => {
      return providers.realmIdentityProviderInstancesAliasPut(env.KEYCLOAK_REALM, ensure(idp.alias), idp)
    })
  }

  // Create Identity Provider Mappers
  // @NOTE - PUT involves adding strict required properties not in the factory
  const idpMappers = realmConfig.createIdpMappers()
  const existingMappers: IdentityProviderMapperRepresentation[] = await doApiCall(
    errors,
    `Getting mappers`,
    () => providers.realmIdentityProviderInstancesAliasMappersGet(env.KEYCLOAK_REALM, env.IDP_ALIAS),
    400,
  )
  await Promise.all(
    idpMappers.map(async (idpMapper) => {
      const existingMapper: IdentityProviderMapperRepresentation | undefined = (existingMappers || []).find(
        (m) => m.name === idpMapper.name,
      )
      if (existingMapper) {
        await doApiCall(
          errors,
          `Updating mapper ${idpMapper.name}`,
          () =>
            providers.realmIdentityProviderInstancesAliasMappersIdPut(
              env.KEYCLOAK_REALM,
              env.IDP_ALIAS,
              existingMapper.id!,
              { ...existingMapper, ...idpMapper },
            ),
          400,
        )
      } else {
        await doApiCall(
          errors,
          `Creating mapper ${idpMapper.name}`,
          () => providers.realmIdentityProviderInstancesAliasMappersPost(env.KEYCLOAK_REALM, env.IDP_ALIAS, idpMapper),
          400,
        )
      }
    }),
  )

  // Create Otomi Client
  const client = realmConfig.createClient()
  const clientExists = await doApiCall(errors, 'Creating otomi client', () =>
    clients.realmClientsPost(env.KEYCLOAK_REALM, client),
  )
  if (clientExists) {
    await doApiCall(errors, 'Updating otomi client', () =>
      clients.realmClientsIdPut(env.KEYCLOAK_REALM, ensure(client.id), client),
    )
  }

  // add email claim for client protocolMappers
  // @NOTE - PUT involves adding strict required properties not in the factory
  await doApiCall(errors, 'creating client email claim', () =>
    protocols.realmClientsIdProtocolMappersModelsPost(
      env.KEYCLOAK_REALM,
      ensure(client.id),
      realmConfig.createClientEmailClaimMapper(),
    ),
  )

  // set login theme
  await doApiCall(errors, 'adding login theme', () =>
    realms.realmPut(env.KEYCLOAK_REALM, realmConfig.createLoginThemeConfig('otomi')),
  )

  handleErrors(errors)
}

// Run main only on execution, not on import (like tests)
if (typeof require !== 'undefined' && require.main === module) {
  main()
}
