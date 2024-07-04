import {
  ClientRepresentation,
  ClientRoleMappingsApi,
  ClientsApi,
  ClientScopeRepresentation,
  ClientScopesApi,
  GroupRepresentation,
  GroupsApi,
  IdentityProviderMapperRepresentation,
  IdentityProviderRepresentation,
  IdentityProvidersApi,
  ProtocolMapperRepresentation,
  ProtocolMappersApi,
  RealmRepresentation,
  RealmsAdminApi,
  RoleMapperApi,
  RoleRepresentation,
  RolesApi,
  UserRepresentation,
  UsersApi,
} from '@linode/keycloak-client-node'
import { forEach } from 'lodash'
import { custom, Issuer, TokenSet } from 'openid-client'
import { doApiCall, handleErrors, waitTillAvailable } from '../../utils'
import {
  cleanEnv,
  FEAT_EXTERNAL_IDP,
  IDP_ALIAS,
  IDP_OIDC_URL,
  KC_HOSTNAME_URL,
  KEYCLOAK_ADDRESS_INTERNAL,
  KEYCLOAK_ADMIN,
  KEYCLOAK_ADMIN_PASSWORD,
  KEYCLOAK_REALM,
  KEYCLOAK_TOKEN_OFFLINE_MAX_TTL_ENABLED,
  KEYCLOAK_TOKEN_OFFLINE_TTL,
  KEYCLOAK_TOKEN_TTL,
  WAIT_OPTIONS,
} from '../../validators'
import { keycloakRealm } from './config'
import {
  createAdminUser,
  createClient,
  createClientEmailClaimMapper,
  createClientScopes,
  createGroups,
  createIdpMappers,
  createIdProvider,
  createLoginThemeConfig,
  createRealm,
  mapTeamsToRoles,
} from './realm-factory'

const env = cleanEnv({
  IDP_ALIAS,
  IDP_OIDC_URL,
  KEYCLOAK_ADMIN,
  KEYCLOAK_ADMIN_PASSWORD,
  KC_HOSTNAME_URL,
  KEYCLOAK_ADDRESS_INTERNAL,
  KEYCLOAK_REALM,
  KEYCLOAK_TOKEN_TTL,
  KEYCLOAK_TOKEN_OFFLINE_TTL,
  KEYCLOAK_TOKEN_OFFLINE_MAX_TTL_ENABLED,
  FEAT_EXTERNAL_IDP,
  WAIT_OPTIONS,
})

const errors: string[] = []

async function main(): Promise<void> {
  await waitTillAvailable(env.KC_HOSTNAME_URL, undefined, env.WAIT_OPTIONS)
  const keycloakAddress = env.KC_HOSTNAME_URL
  const basePath = `${keycloakAddress}/admin/realms`
  let token: TokenSet
  try {
    custom.setHttpOptionsDefaults({ headers: { host: env.KC_HOSTNAME_URL.replace('https://', '') } })
    const keycloakIssuer = await Issuer.discover(`${keycloakAddress}/realms/${env.KEYCLOAK_REALM}/`)
    // console.log(keycloakIssuer)
    const clientOptions: any = {
      client_id: 'admin-cli',
      client_secret: 'unused',
    }
    const openIdConnectClient = new keycloakIssuer.Client(clientOptions)
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
  const api = {
    providers: new IdentityProvidersApi(basePath),
    clientScope: new ClientScopesApi(basePath),
    roles: new RolesApi(basePath),
    clientRoleMappings: new ClientRoleMappingsApi(basePath),
    roleMapper: new RoleMapperApi(basePath),
    clients: new ClientsApi(basePath),
    protocols: new ProtocolMappersApi(basePath),
    realms: new RealmsAdminApi(basePath),
    users: new UsersApi(basePath),
  }
  // eslint-disable-next-line no-return-assign,no-param-reassign
  forEach(api, (a) => (a.accessToken = String(token.access_token)))

  // Create realm 'otomi'
  const realmConf = createRealm(keycloakRealm)
  realmConf.ssoSessionIdleTimeout = env.KEYCLOAK_TOKEN_TTL
  realmConf.ssoSessionMaxLifespan = env.KEYCLOAK_TOKEN_TTL
  realmConf.accessTokenLifespan = env.KEYCLOAK_TOKEN_TTL
  realmConf.accessTokenLifespanForImplicitFlow = env.KEYCLOAK_TOKEN_TTL
  realmConf.offlineSessionMaxLifespanEnabled = env.KEYCLOAK_TOKEN_OFFLINE_MAX_TTL_ENABLED
  realmConf.offlineSessionIdleTimeout = env.KEYCLOAK_TOKEN_OFFLINE_TTL
  realmConf.offlineSessionMaxLifespan = env.KEYCLOAK_TOKEN_OFFLINE_TTL
  // the api does not offer a list method, and trying to get by id throws an error
  // which we wan to discard, so we run the next command with an empty errors array
  const existingRealm = (await doApiCall([], `Getting realm ${keycloakRealm}`, () =>
    api.realms.realmGet(keycloakRealm),
  )) as RealmRepresentation
  if (existingRealm) {
    await doApiCall(errors, `Updating realm ${keycloakRealm}`, async () =>
      api.realms.realmPut(keycloakRealm, realmConf),
    )
  } else {
    await doApiCall(errors, `Creating realm ${keycloakRealm}`, () => api.realms.rootPost(realmConf))
  }

  // Create Client Scopes
  const scope = createClientScopes()
  const clientScopes = (await doApiCall(errors, 'Getting openid client scope', () =>
    api.clientScope.realmClientScopesGet(keycloakRealm),
  )) as Array<ClientScopeRepresentation>
  const existingScope = clientScopes.find((el) => el.name === scope.name)
  if (existingScope) {
    await doApiCall(errors, 'Updating openid client scope', async () =>
      // @NOTE this PUT operation is almost pointless as it is not updating deep nested properties because of various db constraints
      api.clientScope.realmClientScopesIdPut(keycloakRealm, existingScope.id!, scope),
    )
  } else {
    await doApiCall(errors, 'Creating openid client scope', () =>
      api.clientScope.realmClientScopesPost(keycloakRealm, scope),
    )
  }

  // Create realm roles
  interface RealmRole {
    name: string
  }
  const teamRoles = mapTeamsToRoles()
  const existingRealmRoles = ((await doApiCall(errors, `Getting all roles from realm ${keycloakRealm}`, async () =>
    api.roles.realmRolesGet(keycloakRealm),
  )) || []) as Array<RealmRole>
  await Promise.all(
    teamRoles.map((role) => {
      const exists = existingRealmRoles.some((el) => el.name === role.name!)
      if (exists) {
        return doApiCall(errors, `Updating role ${role.name!}`, async () =>
          api.roles.realmRolesRoleNamePut(keycloakRealm, role.name ?? '', role),
        )
      }
      return doApiCall(errors, `Creating role ${role.name!}`, async () => api.roles.realmRolesPost(keycloakRealm, role))
    }),
  )

  // Create Otomi Client
  const client = createClient()
  const allClients = ((await doApiCall(errors, 'Getting otomi client', () =>
    api.clients.realmClientsGet(keycloakRealm),
  )) || []) as Array<ClientRepresentation>
  if (allClients.some((el) => el.name === client.name)) {
    await doApiCall(errors, 'Updating otomi client', () =>
      api.clients.realmClientsIdPut(keycloakRealm, client.id!, client),
    )
  } else {
    await doApiCall(errors, 'Creating otomi client', () => api.clients.realmClientsPost(keycloakRealm, client))
  }

  const allClaims = ((await doApiCall(errors, 'Getting client email claim mapper', () =>
    api.protocols.realmClientsIdProtocolMappersModelsGet(keycloakRealm, client.id!),
  )) || []) as Array<ProtocolMapperRepresentation>
  const mapper = createClientEmailClaimMapper()
  if (!allClaims.some((el) => el.name === mapper.name)) {
    await doApiCall(errors, 'Creating client email claim mapper', () =>
      api.protocols.realmClientsIdProtocolMappersModelsPost(keycloakRealm, client.id!, mapper),
    )
  }

  // set login theme for master realm
  await doApiCall(errors, 'adding theme for login page', () =>
    api.realms.realmPut(env.KEYCLOAK_REALM, createLoginThemeConfig('otomi')),
  )

  if (env.FEAT_EXTERNAL_IDP) {
    // Keycloak acts as broker
    // Create Identity Provider
    const idp = await createIdProvider()

    const existingProviders = ((await doApiCall(errors, 'Geting identity provider', async () =>
      api.providers.realmIdentityProviderInstancesGet(keycloakRealm),
    )) || []) as Array<IdentityProviderRepresentation>

    if (existingProviders.some((el) => el.alias === idp.alias)) {
      await doApiCall(errors, 'Updating identity provider', async () =>
        api.providers.realmIdentityProviderInstancesAliasPut(keycloakRealm, idp.alias!, idp),
      )
    } else {
      await doApiCall(errors, 'Creating identity provider', async () =>
        api.providers.realmIdentityProviderInstancesPost(keycloakRealm, idp),
      )
    }

    // Create Identity Provider Mappers
    const idpMappers = createIdpMappers()

    const existingMappers = ((await doApiCall(errors, `Getting role mappers`, () =>
      api.providers.realmIdentityProviderInstancesAliasMappersGet(keycloakRealm, env.IDP_ALIAS),
    )) || []) as IdentityProviderMapperRepresentation[]

    await Promise.all(
      idpMappers.map((idpMapper) => {
        const existingMapper: IdentityProviderMapperRepresentation | undefined = existingMappers.find(
          (m) => m.name === idpMapper.name,
        )
        if (existingMapper) {
          return doApiCall(errors, `Updating mapper ${idpMapper.name!}`, () =>
            api.providers.realmIdentityProviderInstancesAliasMappersIdPut(
              keycloakRealm,
              env.IDP_ALIAS,
              existingMapper.id!,
              {
                ...existingMapper,
                ...idpMapper,
              },
            ),
          )
        }
        return doApiCall(errors, `Creating mapper ${idpMapper.name!}`, () =>
          api.providers.realmIdentityProviderInstancesAliasMappersPost(keycloakRealm, env.IDP_ALIAS, idpMapper),
        )
      }),
    )
  } else {
    // IDP instead of broker

    // create groups
    const groups = new GroupsApi(basePath)
    groups.accessToken = String(token.access_token)
    const teamGroups = createGroups()

    const existingGroups = ((await doApiCall(errors, 'Getting realm groups', () =>
      groups.realmGroupsGet(keycloakRealm),
    )) || []) as Array<GroupRepresentation>

    await Promise.all(
      teamGroups.map((group) => {
        const groupName = group.name!
        const existingGroup = existingGroups.find((el) => el.name === groupName)
        if (existingGroup) {
          return doApiCall(errors, `Updating groups ${groupName}`, async () =>
            groups.realmGroupsIdPut(keycloakRealm, existingGroup.id!, group),
          )
        }
        return doApiCall(errors, `Creating group ${groupName}`, async () =>
          groups.realmGroupsPost(keycloakRealm, group),
        )
      }),
    )

    const updatedExistingGroups = ((await doApiCall(errors, 'Getting realm groups', () =>
      groups.realmGroupsGet(keycloakRealm),
    )) || []) as Array<GroupRepresentation>

    // get updated existing roles
    const updatedExistingRealmRoles = ((await doApiCall(
      errors,
      `Getting all roles from realm ${keycloakRealm}`,
      async () => api.roles.realmRolesGet(keycloakRealm),
    )) || []) as Array<RealmRole>

    // get clients for access roles
    const realmManagementClients = ((await doApiCall(
      errors,
      `Getting client realm-management from realm ${keycloakRealm}`,
      async () => api.clients.realmClientsGet(keycloakRealm, 'realm-management'),
    )) || []) as Array<ClientRepresentation>
    const realmManagementClient = realmManagementClients.find(
      (el) => el.clientId === 'realm-management',
    ) as ClientRepresentation

    const realmManagementRoles = ((await doApiCall(
      errors,
      `Getting realm-management roles from realm ${keycloakRealm}`,
      async () => api.roles.realmClientsIdRolesGet(keycloakRealm, realmManagementClient.id!),
    )) || []) as Array<RealmRole>
    const realmManagementRole = realmManagementRoles.find((el) => el.name === 'manage-realm') as RoleRepresentation
    const userManagementRole = realmManagementRoles.find((el) => el.name === 'manage-users') as RoleRepresentation
    const userViewerRole = realmManagementRoles.find((el) => el.name === 'view-users') as RoleRepresentation

    // attach roles to groups
    await Promise.all(
      updatedExistingGroups.map(async (group) => {
        const groupName = group.name!
        // get realm roles for group
        const existingRoleMappings = ((await doApiCall(
          errors,
          `Getting all roles from realm ${keycloakRealm} for group ${groupName}`,
          async () => api.roleMapper.realmGroupsIdRoleMappingsRealmGet(keycloakRealm, group.id!),
        )) || []) as Array<RoleRepresentation>
        const existingRoleMapping = existingRoleMappings.find((el) => el.name === groupName)
        if (!existingRoleMapping) {
          // set realm roles
          const roles: Array<RoleRepresentation> = []
          const existingRole = updatedExistingRealmRoles.find(
            (el) => el.name === (groupName === 'otomi-admin' ? 'admin' : groupName),
          ) as RoleRepresentation
          roles.push(existingRole)
          await doApiCall(errors, `Creating role mapping for group ${groupName}`, async () =>
            api.roleMapper.realmGroupsIdRoleMappingsRealmPost(keycloakRealm, group.id!, roles),
          )
        }
        // get client roles for group
        const existingClientRoleMappings = ((await doApiCall(
          errors,
          `Getting all client roles from realm ${keycloakRealm} for group ${groupName}`,
          async () =>
            api.clientRoleMappings.realmGroupsIdRoleMappingsClientsClientGet(
              keycloakRealm,
              group.id!,
              realmManagementClient.id!,
            ),
        )) || []) as Array<RoleRepresentation>
        const existingClientRoleMapping = existingClientRoleMappings.find((el) => el.name === groupName)
        if (!existingClientRoleMapping) {
          // let team members see other users
          const accessRoles: Array<RoleRepresentation> = [userViewerRole]
          // both otomi-admin and team-admin role will get access to manage users
          // so the otomi-admin can login to the 'otomi' realm just like team-admin and see the same
          if (groupName === 'team-admin') accessRoles.push(userManagementRole)
          if (groupName === 'otomi-admin') accessRoles.push(realmManagementRole)
          await doApiCall(
            errors,
            `Creating access roles [${accessRoles.map((r) => r.name).join(',')}] mapping for group ${groupName}`,
            async () =>
              api.clientRoleMappings.realmGroupsIdRoleMappingsClientsClientPost(
                keycloakRealm,
                group.id!,
                realmManagementClient.id!,
                accessRoles,
              ),
          )
        }
      }),
    )

    // Create default admin user in realm 'otomi'
    const userConf = createAdminUser(env.KEYCLOAK_ADMIN, env.KEYCLOAK_ADMIN_PASSWORD)
    const existingUsersByAdminEmail = (await doApiCall([], `Getting users`, () =>
      api.users.realmUsersGet(keycloakRealm, false, userConf.email),
    )) as UserRepresentation[]
    const existingUser: UserRepresentation = existingUsersByAdminEmail?.[0]
    if (existingUser) {
      await doApiCall(errors, `Updating user ${env.KEYCLOAK_ADMIN}`, async () =>
        api.users.realmUsersIdPut(keycloakRealm, existingUser.id as string, userConf),
      )
    } else {
      await doApiCall(errors, `Creating user ${env.KEYCLOAK_ADMIN}`, () =>
        api.users.realmUsersPost(keycloakRealm, userConf),
      )
    }
  }

  handleErrors(errors)
}

// Run main only on execution, not on import (like tests)
if (typeof require !== 'undefined' && require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main()
}
