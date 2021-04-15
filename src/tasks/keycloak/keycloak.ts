/* eslint-disable @typescript-eslint/camelcase */
import { Issuer } from 'openid-client'
import {
  ClientsApi,
  IdentityProvidersApi,
  ClientScopesApi,
  RolesApi,
  HttpError,
  ProtocolMappersApi,
  RealmsAdminApi,
} from '@redkubes/keycloak-client-node'
import { find } from 'lodash'
import { IncomingMessage } from 'http'
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
import { ensure } from '../../utils'

const env = cleanEnv({
  IDP_ALIAS,
  KEYCLOAK_ADMIN,
  KEYCLOAK_ADMIN_PASSWORD,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
  KEYCLOAK_THEME_LOGIN,
})

const errors: string[] = []

async function doApiCall(
  resource: string,
  fn: () => Promise<{ response: IncomingMessage; body?: any }>,
  update = false,
): Promise<boolean> {
  console.info(`Running ${update ? 'update' : 'create'} for '${resource}'`)
  try {
    await fn()
    console.info(`Successful ${update ? 'update' : 'create'} for '${resource}'`)
    return true
  } catch (e) {
    if (e instanceof HttpError) {
      const statusCode = e.statusCode ?? 0
      if ([400, 409].includes(statusCode)) console.warn(`${resource}: already exists.`)
      else errors.push(`${resource} HTTP error ${statusCode}: ${e.message}`)
    } else errors.push(`Error processing '${resource}': ${e}`)
    return false
  }
}

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
  const clientScopesExists = !(await doApiCall('OpenID Client Scope', async () =>
    clientScope.realmClientScopesPost(env.KEYCLOAK_REALM, scope),
  ))
  if (clientScopesExists) {
    // @NOTE this PUT operation is almost pointless as it is not updating deep nested properties because of various db constraints
    await doApiCall(
      'OpenID Client Scope',
      async () => {
        const currentClientScopes = await clientScope.realmClientScopesGet(env.KEYCLOAK_REALM)
        const { id } = ensure(find(currentClientScopes.body, { name: scope.name }))
        return clientScope.realmClientScopesIdPut(env.KEYCLOAK_REALM, ensure(id), scope)
      },
      true,
    )
  }

  // Create Roles
  const teamRoles = realmConfig.mapTeamsToRoles()
  await Promise.all(
    teamRoles.map(
      async (role): Promise<void> => {
        const exists = !(await doApiCall(`Role ${role.name}`, async () =>
          roles.realmRolesPost(env.KEYCLOAK_REALM, role),
        ))
        if (exists)
          await doApiCall(
            `Role ${role.name}`,
            async () => roles.realmRolesRoleNamePut(env.KEYCLOAK_REALM, role.name ?? '', role),
            true,
          )
      },
    ),
  )

  // Create Identity Provider
  const idpExists = !(await doApiCall('Identity Provider', async () => {
    const idp = await realmConfig.createIdProvider()
    return providers.realmIdentityProviderInstancesPost(env.KEYCLOAK_REALM, idp)
  }))
  if (idpExists) {
    await doApiCall(
      'Identity Provider',
      async () => {
        const idp = await realmConfig.createIdProvider()
        return providers.realmIdentityProviderInstancesAliasPut(env.KEYCLOAK_REALM, ensure(idp.alias), idp)
      },
      true,
    )
  }

  // Create Identity Provider Mappers
  // @NOTE - PUT involves adding strict required properties not in the factory
  const idpMappers = realmConfig.createIdpMappers()
  await Promise.all(
    idpMappers.map(async (idpMapper) => {
      await doApiCall(`Mapping ${idpMapper.name}`, async () => {
        return providers.realmIdentityProviderInstancesAliasMappersPost(env.KEYCLOAK_REALM, env.IDP_ALIAS, idpMapper)
      })
    }),
  )

  // Create Otomi Client
  const client = realmConfig.createClient()
  const clientExists = await doApiCall('Otomi Client', async () => clients.realmClientsPost(env.KEYCLOAK_REALM, client))
  if (clientExists) {
    await doApiCall(
      'Otomi Client',
      async () => {
        return clients.realmClientsIdPut(env.KEYCLOAK_REALM, ensure(client.id), client)
      },
      true,
    )
  }

  // add email claim for client protocolMappers
  // @NOTE - PUT involves adding strict required properties not in the factory
  await doApiCall('Client Email Claim', async () =>
    protocols.realmClientsIdProtocolMappersModelsPost(
      env.KEYCLOAK_REALM,
      ensure(client.id),
      realmConfig.createClientEmailClaimMapper(),
    ),
  )

  // set login theme
  if (env.KEYCLOAK_THEME_LOGIN !== 'default')
    await doApiCall('Login Theme', async () =>
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
