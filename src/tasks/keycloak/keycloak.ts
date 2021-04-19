/* eslint-disable @typescript-eslint/camelcase */
import { Issuer } from 'openid-client'
import {
  ClientsApi,
  IdentityProvidersApi,
  ClientScopesApi,
  RolesApi,
  ProtocolMappersApi,
  RealmsAdminApi,
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
  KEYCLOAK_THEME_LOGIN,
} from '../../validators'
import { doApiCall, ensure } from '../../utils'

const env = cleanEnv({
  IDP_ALIAS,
  KEYCLOAK_ADMIN,
  KEYCLOAK_ADMIN_PASSWORD,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
  KEYCLOAK_THEME_LOGIN,
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
  const clientScopes = !(await doApiCall(errors, 'creating OpenID Client Scope', () =>
    clientScope.realmClientScopesPost(env.KEYCLOAK_REALM, scope),
  ))
  if (clientScopes) {
    // @NOTE this PUT operation is almost pointless as it is not updating deep nested properties because of various db constraints
    await doApiCall(errors, 'updating OpenID Client Scope', async () => {
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
        const exists = await doApiCall(errors, `creating Role ${role.name}`, async () =>
          roles.realmRolesPost(env.KEYCLOAK_REALM, role),
        )
        if (exists)
          await doApiCall(errors, `updating Role ${role.name}`, async () =>
            roles.realmRolesRoleNamePut(env.KEYCLOAK_REALM, role.name ?? '', role),
          )
      },
    ),
  )

  // Create Identity Provider
  const idp = await realmConfig.createIdProvider()
  const idpExists = await doApiCall(errors, 'creating Identity Provider', async () => {
    return providers.realmIdentityProviderInstancesPost(env.KEYCLOAK_REALM, idp)
  })
  if (idpExists) {
    await doApiCall(errors, 'updating Identity Provider', async () => {
      return providers.realmIdentityProviderInstancesAliasPut(env.KEYCLOAK_REALM, ensure(idp.alias), idp)
    })
  }

  // Create Identity Provider Mappers
  // @NOTE - PUT involves adding strict required properties not in the factory
  const idpMappers = realmConfig.createIdpMappers()
  await Promise.all(
    idpMappers.map(async (idpMapper) =>
      doApiCall(
        errors,
        `creating mapper ${idpMapper.name}`,
        () => providers.realmIdentityProviderInstancesAliasMappersPost(env.KEYCLOAK_REALM, env.IDP_ALIAS, idpMapper),
        400,
      ),
    ),
  )

  // Create Otomi Client
  const client = realmConfig.createClient()
  const clientExists = await doApiCall(errors, 'creating Otomi Client', () =>
    clients.realmClientsPost(env.KEYCLOAK_REALM, client),
  )
  if (clientExists) {
    await doApiCall(errors, 'updating Otomi Client', () =>
      clients.realmClientsIdPut(env.KEYCLOAK_REALM, ensure(client.id), client),
    )
  }

  // add email claim for client protocolMappers
  // @NOTE - PUT involves adding strict required properties not in the factory
  await doApiCall(errors, 'creating Client Email Claim', () =>
    protocols.realmClientsIdProtocolMappersModelsPost(
      env.KEYCLOAK_REALM,
      ensure(client.id),
      realmConfig.createClientEmailClaimMapper(),
    ),
  )

  // set login theme
  if (env.KEYCLOAK_THEME_LOGIN !== 'default')
    await doApiCall(errors, 'adding Login Theme', () =>
      realms.realmPut(env.KEYCLOAK_REALM, realmConfig.createLoginThemeConfig(env.KEYCLOAK_THEME_LOGIN)),
    )

  // check errors and exit
  if (errors.length) {
    console.error(`Errors found: ${JSON.stringify(errors, null, 2)}`)
    process.exit(1)
  } else {
    console.info('Success!')
  }
}

// Run main only on execution, not on import (like tests)
if (typeof require !== 'undefined' && require.main === module) {
  main()
}
