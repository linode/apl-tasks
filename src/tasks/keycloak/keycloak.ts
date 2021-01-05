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
  AuthenticationManagementApi,
} from '@redkubes/keycloak-client-node'
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
import { find } from 'lodash'

const env = cleanEnv({
  IDP_ALIAS,
  KEYCLOAK_ADMIN,
  KEYCLOAK_ADMIN_PASSWORD,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
  KEYCLOAK_THEME_LOGIN,
})

const errors = []

async function doApiCall(resource: string, fn: () => Promise<void>, update = false): Promise<boolean> {
  console.info(`Running ${update ? 'update' : 'create'} for '${resource}'`)
  try {
    await fn()
    console.info(`Successful ${update ? 'update' : 'create'} for '${resource}'`)
    return true
  } catch (e) {
    if (e instanceof HttpError) {
      if ([400, 409].includes(e.statusCode)) console.warn(`${resource}: already exists.`)
      else errors.push(`${resource} HTTP error ${e.statusCode}: ${e.message}`)
    } else errors.push(`Error processing '${resource}': ${e}`)
    return false
  }
}

async function main() {
  let basePath, token
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
    console.log('Exiting!')
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
  const authn = new AuthenticationManagementApi(basePath)
  authn.accessToken = String(token.access_token)

  // Create Client Scopes
  if (
    !(await doApiCall('OpenID Client Scope', async () => {
      await clientScope.realmClientScopesPost(env.KEYCLOAK_REALM, realmConfig.createClientScopes())
    }))
  ) {
    // @NOTE this PUT operation is almost pointless as it is not updating deep nested properties because of various db constraints
    await doApiCall(
      'OpenID Client Scope',
      async () => {
        const currentClientScopes = await clientScope.realmClientScopesGet(env.KEYCLOAK_REALM)
        const scope = realmConfig.createClientScopes()
        const id = find(currentClientScopes.body, { name: scope.name }).id
        await clientScope.realmClientScopesIdPut(env.KEYCLOAK_REALM, id, scope)
      },
      true,
    )
  }

  // Create Roles
  for await (const role of realmConfig.mapTeamsToRoles()) {
    if (
      !(await doApiCall(`Role ${role.name}`, async () => {
        await roles.realmRolesPost(env.KEYCLOAK_REALM, role)
      }))
    ) {
      await doApiCall(
        `Role ${role.name}`,
        async () => {
          await roles.realmRolesRoleNamePut(env.KEYCLOAK_REALM, role.name, role)
        },
        true,
      )
    }
  }

  // Create Identity Provider
  if (
    !(await doApiCall('Identity Provider', async () => {
      await providers.realmIdentityProviderInstancesPost(env.KEYCLOAK_REALM, await realmConfig.createIdProvider())
    }))
  ) {
    await doApiCall(
      'Identity Provider',
      async () => {
        const idp = await realmConfig.createIdProvider()
        await providers.realmIdentityProviderInstancesAliasPut(env.KEYCLOAK_REALM, idp.alias, idp)
      },
      true,
    )
  }

  // Create Identity Provider Mappers
  // @NOTE - PUT involves adding strict required properties not in the factory
  for await (const idpMapper of realmConfig.createIdpMappers()) {
    await doApiCall(`Mapping ${idpMapper.name}`, async () => {
      await providers.realmIdentityProviderInstancesAliasMappersPost(env.KEYCLOAK_REALM, env.IDP_ALIAS, idpMapper)
    })
  }

  // Create Otomi Client
  const client = realmConfig.createClient()
  if (
    !(await doApiCall('Otomi Client', async () => {
      await clients.realmClientsPost(env.KEYCLOAK_REALM, client)
    }))
  ) {
    await doApiCall(
      'Otomi Client',
      async () => {
        await clients.realmClientsIdPut(env.KEYCLOAK_REALM, client.id, client)
      },
      true,
    )
  }

  // add email claim for client protocolMappers
  // @NOTE - PUT involves adding strict required properties not in the factory
  await doApiCall('Client Email Claim', async () => {
    await protocols.realmClientsIdProtocolMappersModelsPost(
      env.KEYCLOAK_REALM,
      client.id,
      realmConfig.createClientEmailClaimMapper(),
    )
  })

  // set login theme
  if (env.KEYCLOAK_THEME_LOGIN !== 'default')
    await doApiCall('Login Theme', async () => {
      await realms.realmPut(env.KEYCLOAK_REALM, realmConfig.createLoginThemeConfig(env.KEYCLOAK_THEME_LOGIN))
    })

  // Ensure Auto-Link User after IDP first registration

  const flowAlias = 'first broker login'
  await doApiCall(`Clone Authn Flows: ${flowAlias}`, async () => {
    await authn.realmAuthenticationFlowsFlowAliasCopyPost(env.KEYCLOAK_REALM, flowAlias, {
      authenticationExecutions2: [],
    })
  })

  for (const flow of realmConfig.createAuthnFlows()) {
    await doApiCall(`Authn Flows: ${flow.alias}`, async () => {
      await authn.realmAuthenticationFlowsPost(env.KEYCLOAK_REALM, flow)
    })

    flow.authenticationExecutions.map(async (exec: any) => {
      await doApiCall(`Authn Flow Exec: ${flow.alias}`, async () => {
        if (exec.flowAlias) {
          await authn.realmAuthenticationFlowsFlowAliasExecutionsFlowPost(env.KEYCLOAK_REALM, flow.alias, exec)
        } else {
          await authn.realmAuthenticationFlowsFlowAliasExecutionsExecutionPost(env.KEYCLOAK_REALM, flow.alias, exec)
        }
      })
    })
  }

  // check errors and exit
  if (errors.length) {
    console.error(JSON.stringify(errors, null, 2))
    console.log('Exiting!')
    process.exit(1)
  } else {
    console.info('Success!')
  }
}

main()
