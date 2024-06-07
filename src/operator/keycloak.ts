import Operator, { ResourceEventType } from '@dot-i/k8s-operator'
import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'
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
  RealmsAdminApi,
  RoleMapperApi,
  RoleRepresentation,
  RolesApi,
  UserRepresentation,
  UsersApi,
} from '@redkubes/keycloak-client-node'
import { forEach } from 'lodash'
import { custom, Issuer, TokenSet } from 'openid-client'
import { keycloakRealm } from '../tasks/keycloak/config'
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
} from '../tasks/keycloak/realm-factory'
import { doApiCall, waitTillAvailable } from '../utils'
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
  KEYCLOAK_TOKEN_TTL,
  WAIT_OPTIONS,
} from '../validators'

const errors: string[] = []

interface KeycloakConnection {
  basePath: string
  token: TokenSet
}

interface KeycloakApi {
  providers: IdentityProvidersApi
  clientScope: ClientScopesApi
  roles: RolesApi
  clientRoleMappings: ClientRoleMappingsApi
  roleMapper: RoleMapperApi
  clients: ClientsApi
  protocols: ProtocolMappersApi
  realms: RealmsAdminApi
  users: UsersApi
}

// Create realm roles
interface RealmRole {
  name: string
}
const newEnv = {
  IDP_ALIAS: '',
  IDP_OIDC_URL: '',
  KEYCLOAK_ADMIN: '',
  KEYCLOAK_ADMIN_PASSWORD: '',
  KC_HOSTNAME_URL: '',
  KEYCLOAK_ADDRESS_INTERNAL: '',
  KEYCLOAK_REALM: '',
  KEYCLOAK_TOKEN_TTL: 0,
  FEAT_EXTERNAL_IDP: 'false',
  WAIT_OPTIONS: '',
}
const env = cleanEnv({
  IDP_ALIAS,
  IDP_OIDC_URL,
  KEYCLOAK_ADMIN,
  KEYCLOAK_ADMIN_PASSWORD,
  KC_HOSTNAME_URL,
  KEYCLOAK_ADDRESS_INTERNAL,
  KEYCLOAK_REALM,
  KEYCLOAK_TOKEN_TTL,
  FEAT_EXTERNAL_IDP,
  WAIT_OPTIONS,
})

const kc = new KubeConfig()
// loadFromCluster when deploying on cluster
// loadFromDefault when locally connecting to cluster
kc.loadFromCluster()
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

async function runKeycloakUpdater(key: string) {
  switch (key) {
    case 'addTeam':
      try {
        await keycloakTeamAdded()
      } catch (error) {
        console.debug('Error could not add team', error)
        console.debug('Retrying in 30 seconds')
        await new Promise((resolve) => setTimeout(resolve, 30000))
        console.log('Retrying to add team')
        await runKeycloakUpdater('addTeam')
      }
      break
    case 'removeTeam':
      try {
        await keycloakTeamDeleted()
      } catch (error) {
        console.debug('Error could not delete team', error)
        console.debug('Retrying in 30 seconds')
        await new Promise((resolve) => setTimeout(resolve, 30000))
        console.log('Retrying to delete team')
        await runKeycloakUpdater('removeTeam')
      }
      break
    case 'updateConfig':
      try {
        await keycloakConfigMapChanges()
      } catch (error) {
        console.debug('Error could not update configMap', error)
        console.debug('Retrying in 30 seconds')
        await new Promise((resolve) => setTimeout(resolve, 30000))
        console.log('Retrying to update configMap')
        await runKeycloakUpdater('updateConfig')
      }
      break
    default:
      break
  }
}

export default class MyOperator extends Operator {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  protected async init() {
    // Watch otomi-keycloak-operator-secret
    try {
      console.log('Watching secrets!')
      await this.watchResource(
        '',
        'v1',
        'secrets',
        async (e) => {
          const { object }: { object: k8s.V1Secret } = e
          const { metadata, data } = object
          if (metadata && metadata.name !== 'otomi-keycloak-operator-secret') return
          switch (e.type) {
            case ResourceEventType.Added:
            case ResourceEventType.Modified: {
              try {
                const secretData = (await k8sApi.readNamespacedSecret('keycloak-admin', 'otomi-keycloak-operator')).body.data as any
                newEnv.KEYCLOAK_ADMIN_PASSWORD = Buffer.from(secretData.password, 'base64').toString()
                newEnv.KEYCLOAK_ADMIN = Buffer.from(secretData.username, 'base64').toString()
                console.log('KEYCLOAK_ADMIN_PASSWORD', newEnv.KEYCLOAK_ADMIN_PASSWORD)
              } catch (error) {
                console.debug(error)
              }
              break
            }
            default:
              break
          }
        },
        'otomi-keycloak-operator',
      )
      console.log('Watching secrets done!')
    } catch (error) {
      console.debug(error)
    }
    // Watch otomi-keycloak-operator-cm
    try {
      console.log('Watching configmap!')
      await this.watchResource(
        '',
        'v1',
        'configmaps',
        async (e) => {
          const { object }: { object: k8s.V1ConfigMap } = e
          const { metadata, data } = object
          if (metadata && metadata.name !== 'otomi-keycloak-operator-cm') return
          switch (e.type) {
            case ResourceEventType.Added:
            case ResourceEventType.Modified: {
              try {
                newEnv.FEAT_EXTERNAL_IDP = data!.FEAT_EXTERNAL_IDP
                newEnv.IDP_ALIAS = data!.IDP_ALIAS
                newEnv.IDP_OIDC_URL = data!.IDP_OIDC_URL
                newEnv.KC_HOSTNAME_URL = data!.KC_HOSTNAME_URL
                newEnv.KEYCLOAK_ADDRESS_INTERNAL = data!.KEYCLOAK_ADDRESS_INTERNAL
                newEnv.KEYCLOAK_REALM = data!.KEYCLOAK_REALM
                newEnv.KEYCLOAK_TOKEN_TTL = data!.KEYCLOAK_TOKEN_TTL as unknown as number
                newEnv.WAIT_OPTIONS = data!.WAIT_OPTIONS
              } catch (error) {
                console.debug(error)
              }
              break
            }
            default:
              break
          }
        },
        'otomi-keycloak-operator',
      )
      console.log('Watching configmap done!')
    } catch (error) {
      console.debug(error)
    }
    // Watch team namespaces to see if teams get added or removed
    try {
      await this.watchResource('', 'v1', 'namespaces', async (e) => {
        const { object }: { object: k8s.V1Pod } = e
        const { metadata } = object
        // Check if namespace starts with prefix 'team-'
        if (metadata && !metadata.name?.startsWith('team-')) return
        if (metadata && metadata.name === 'team-admin') return
        if (object.kind === 'add') await runKeycloakUpdater('addTeam')
        if (object.kind === 'remove') await runKeycloakUpdater('removeTeam')
      })
    } catch (error) {
      console.debug(error)
    }
    // Watch configmaps to check if keycloak need to be updated
    try {
      await this.watchResource('', 'v1', 'configmaps', async (e) => {
        const { object }: { object: k8s.V1Pod } = e
        const { metadata } = object
        // Check if namespace starts with prefix 'team-'
        if (metadata && !metadata.name?.startsWith('team-')) return
        if (metadata && metadata.name === 'team-admin') return
        await runKeycloakUpdater('updateConfig')
      })
    } catch (error) {
      console.debug(error)
    }
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()
  console.info(`Listening to team namespace changes in all namespaces`)
  console.info('Setting up namespace prefix filter to "team-"')
  await operator.start()
  const exit = (reason: string) => {
    operator.stop()
    process.exit(0)
  }

  process.on('SIGTERM', () => exit('SIGTERM')).on('SIGINT', () => exit('SIGINT'))
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
async function keycloakConfigMapChanges() {
  const connection = await createKeycloakConnection()
  const api = setupKeycloakApi(connection)
  keycloakRealmProviderConfigurer(api)
  if (env.FEAT_EXTERNAL_IDP) externalIDP(api)
  else internalIdp(api, connection)
}

async function keycloakTeamAdded() {
  const connection = await createKeycloakConnection()
  const api = setupKeycloakApi(connection)
  await manageGroups(connection)
}

async function keycloakTeamDeleted() {
  const connection = await createKeycloakConnection()
  const api = setupKeycloakApi(connection)
  await manageGroups(connection)
}

async function createKeycloakConnection(): Promise<KeycloakConnection> {
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
    return { token, basePath } as KeycloakConnection
  } catch (error) {
    console.error(error)
    console.info('Exiting!')
    throw error
  }
}

function setupKeycloakApi(connection: KeycloakConnection) {
  const { basePath, token } = connection
  // Configure AccessToken for service calls
  const api: KeycloakApi = {
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
  return api
}

async function keycloakRealmProviderConfigurer(api: KeycloakApi) {
  // Create realm 'otomi'
  const realmConf = createRealm(keycloakRealm)
  realmConf.ssoSessionIdleTimeout = env.KEYCLOAK_TOKEN_TTL
  realmConf.ssoSessionMaxLifespan = env.KEYCLOAK_TOKEN_TTL
  realmConf.accessTokenLifespan = env.KEYCLOAK_TOKEN_TTL
  realmConf.accessTokenLifespanForImplicitFlow = env.KEYCLOAK_TOKEN_TTL
  // the api does not offer a list method, and trying to get by id throws an error
  // which we wan to discard, so we run the next command with an empty errors array
  const existingRealm = await doApiCall([], `Getting realm ${keycloakRealm}`, () => api.realms.realmGet(keycloakRealm))
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
}

async function externalIDP(api: KeycloakApi) {
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
}

async function internalIdp(api: KeycloakApi, connection: KeycloakConnection) {
  // IDP instead of broker

  // create groups
  const { basePath, token } = connection
  const groups = new GroupsApi(basePath)
  groups.accessToken = String(token.access_token)

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

async function manageGroups(connection: KeycloakConnection) {
  const { basePath } = connection
  const groups = new GroupsApi(basePath)
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
      return doApiCall(errors, `Creating group ${groupName}`, async () => groups.realmGroupsPost(keycloakRealm, group))
    }),
  )
}
