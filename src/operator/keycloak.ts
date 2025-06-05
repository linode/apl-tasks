import * as k8s from '@kubernetes/client-node'
import Operator, { ResourceEventType } from '@linode/apl-k8s-operator'
import {
  ClientRoleMappingsApi,
  ClientsApi,
  ClientScopesApi,
  GroupsApi,
  HttpBearerAuth,
  IdentityProvidersApi,
  ProtocolMappersApi,
  RealmsAdminApi,
  RequestFile,
  RoleMapperApi,
  RoleRepresentation,
  RolesApi,
  UserRepresentation,
  UsersApi,
} from '@linode/keycloak-client-node'
import { forEach, omit } from 'lodash'
import { custom, Issuer, TokenSet } from 'openid-client'
import { keycloakRealm } from '../tasks/keycloak/config'
import { extractError } from '../tasks/keycloak/errors'
import {
  createAdminUser,
  createClient,
  createClientEmailClaimMapper,
  createClientScopes,
  createClientSubClaimMapper,
  createGroups,
  createIdpMappers,
  createIdProvider,
  createLoginThemeConfig,
  createRealm,
  createTeamUser,
  mapTeamsToRoles,
} from '../tasks/keycloak/realm-factory'
import { isObjectSubsetDifferent } from '../utils'
import {
  cleanEnv,
  KC_ACCESS_TOKEN_LIFESPAN,
  KC_ACCESS_TOKEN_LIFESPAN_FOR_IMPLICIT_FLOW,
  KC_OFFLINE_SESSION_IDLE_TIMEOUT,
  KC_OFFLINE_SESSION_MAX_LIFESPAN,
  KC_OFFLINE_SESSION_MAX_LIFESPAN_ENABLED,
  KC_SESSION_IDLE_TIMEOUT,
  KC_SESSION_MAX_LIFESPAN,
} from '../validators'

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
  groups: GroupsApi
}

// Create realm roles
interface RealmRole {
  name: string
}

const localEnv = cleanEnv({
  KC_SESSION_IDLE_TIMEOUT,
  KC_SESSION_MAX_LIFESPAN,
  KC_ACCESS_TOKEN_LIFESPAN,
  KC_ACCESS_TOKEN_LIFESPAN_FOR_IMPLICIT_FLOW,
  KC_OFFLINE_SESSION_MAX_LIFESPAN_ENABLED,
  KC_OFFLINE_SESSION_IDLE_TIMEOUT,
  KC_OFFLINE_SESSION_MAX_LIFESPAN,
})

const env = {
  FIRST_RUN: false,
  FEAT_EXTERNAL_IDP: 'false',
  IDP_ALIAS: 'otomi-idp',
  IDP_OIDC_URL: '',
  IDP_CLIENT_ID: '',
  IDP_CLIENT_SECRET: '',
  IDP_GROUP_TEAM_ADMIN: '',
  IDP_GROUP_ALL_TEAMS_ADMIN: '',
  IDP_GROUP_PLATFORM_ADMIN: '',
  IDP_GROUP_MAPPINGS_TEAMS: {},
  IDP_SUB_CLAIM_MAPPER: '',
  IDP_USERNAME_CLAIM_MAPPER: '',
  KEYCLOAK_ADDRESS_INTERNAL: '',
  KEYCLOAK_ADMIN: '',
  KEYCLOAK_ADMIN_PASSWORD: '',
  KEYCLOAK_CLIENT_SECRET: '',
  KEYCLOAK_HOSTNAME_URL: '',
  KEYCLOAK_REALM: '',
  KC_SESSION_IDLE_TIMEOUT: localEnv.KC_SESSION_IDLE_TIMEOUT,
  KC_SESSION_MAX_LIFESPAN: localEnv.KC_SESSION_MAX_LIFESPAN,
  KC_ACCESS_TOKEN_LIFESPAN: localEnv.KC_ACCESS_TOKEN_LIFESPAN,
  KC_ACCESS_TOKEN_LIFESPAN_FOR_IMPLICIT_FLOW: localEnv.KC_ACCESS_TOKEN_LIFESPAN_FOR_IMPLICIT_FLOW,
  KC_OFFLINE_SESSION_MAX_LIFESPAN_ENABLED: localEnv.KC_OFFLINE_SESSION_MAX_LIFESPAN_ENABLED,
  KC_OFFLINE_SESSION_IDLE_TIMEOUT: localEnv.KC_OFFLINE_SESSION_IDLE_TIMEOUT,
  KC_OFFLINE_SESSION_MAX_LIFESPAN: localEnv.KC_OFFLINE_SESSION_MAX_LIFESPAN,
  REDIRECT_URIS: [] as string[],
  TEAM_IDS: [] as string[],
  WAIT_OPTIONS: {},
  USERS: [],
}

const kc = new k8s.KubeConfig()
// loadFromCluster when deploying on cluster
// loadFromDefault when locally connecting to cluster
if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
  kc.loadFromCluster()
} else {
  kc.loadFromDefault()
}

// eslint-disable-next-line no-unused-vars
async function retryOperation(operation: (...args: any[]) => Promise<void>, operationName: string, ...params: any[]) {
  while (true)
    try {
      await operation(...params)
      return
    } catch (error) {
      extractError(operationName, error)
      console.debug('Retrying in 30 seconds')
      await new Promise((resolve) => setTimeout(resolve, 30000))
      console.info(`Retrying to ${operationName}`)
    }
}

async function runKeycloakUpdater() {
  if (JSON.parse(env.FEAT_EXTERNAL_IDP)) {
    if (
      !env.IDP_ALIAS ||
      !env.IDP_OIDC_URL ||
      !env.IDP_CLIENT_ID ||
      !env.IDP_CLIENT_SECRET ||
      !env.IDP_GROUP_PLATFORM_ADMIN ||
      !env.IDP_GROUP_ALL_TEAMS_ADMIN ||
      !env.IDP_GROUP_MAPPINGS_TEAMS ||
      !env.IDP_SUB_CLAIM_MAPPER ||
      !env.IDP_USERNAME_CLAIM_MAPPER
    ) {
      console.info('Missing required external IDP variables for Keycloak setup/reconfiguration')
      return
    }
  }

  if (
    !env.KEYCLOAK_HOSTNAME_URL ||
    !env.KEYCLOAK_ADDRESS_INTERNAL ||
    !env.KEYCLOAK_ADMIN ||
    !env.KEYCLOAK_ADMIN_PASSWORD ||
    !env.KEYCLOAK_REALM ||
    !env.KC_SESSION_IDLE_TIMEOUT ||
    !env.KC_SESSION_MAX_LIFESPAN ||
    !env.KC_ACCESS_TOKEN_LIFESPAN ||
    !env.KC_ACCESS_TOKEN_LIFESPAN_FOR_IMPLICIT_FLOW ||
    !env.KC_OFFLINE_SESSION_MAX_LIFESPAN_ENABLED ||
    !env.KC_OFFLINE_SESSION_IDLE_TIMEOUT ||
    !env.KC_OFFLINE_SESSION_MAX_LIFESPAN ||
    !env.WAIT_OPTIONS
  ) {
    console.info('Missing required keycloak variables for Keycloak setup/reconfiguration')
    return
  }

  await retryOperation(async () => {
    const connection = await createKeycloakConnection()
    const api = setupKeycloakApi(connection)
    await keycloakConfigMapChanges(api)
    await manageGroups(api)
    if (!JSON.parse(env.FEAT_EXTERNAL_IDP)) {
      await manageUsers(api, env.USERS as Record<string, any>[])
    }
  }, 'update from config')
  console.info('Updated Config')
}

export default class MyOperator extends Operator {
  protected async init() {
    let secretInitialized = false
    let configMapInitialized = false

    // Watch apl-keycloak-operator-secret
    try {
      console.info('Setting up secrets watcher')
      await this.watchResource(
        '',
        'v1',
        'secrets',
        async (e) => {
          const { object } = e
          const { metadata, data } = object as k8s.V1Secret
          if (metadata && metadata.name !== 'apl-keycloak-operator-secret') return
          switch (e.type) {
            case ResourceEventType.Added:
            case ResourceEventType.Modified: {
              try {
                env.KEYCLOAK_ADMIN_PASSWORD = Buffer.from(data!.KEYCLOAK_ADMIN_PASSWORD, 'base64').toString()
                env.KEYCLOAK_ADMIN = Buffer.from(data!.KEYCLOAK_ADMIN, 'base64').toString()
                env.KEYCLOAK_CLIENT_SECRET = Buffer.from(data!.KEYCLOAK_CLIENT_SECRET, 'base64').toString()
                if (data!.IDP_CLIENT_ID) env.IDP_CLIENT_ID = Buffer.from(data!.IDP_CLIENT_ID, 'base64').toString()
                if (data!.IDP_CLIENT_SECRET)
                  env.IDP_CLIENT_SECRET = Buffer.from(data!.IDP_CLIENT_SECRET, 'base64').toString()
                env.USERS = JSON.parse(Buffer.from(data!.USERS, 'base64').toString())
                configMapInitialized = true
                if (secretInitialized) await runKeycloakUpdater()
                break
              } catch (error) {
                throw extractError('handling secret update event', error)
              }
            }
            default:
              break
          }
        },
        'apl-keycloak-operator',
      )
      console.info('Setting up secrets watcher done')
    } catch (error) {
      throw extractError('setting up secrets watcher', error)
    }
    // Watch apl-keycloak-operator-cm
    try {
      console.info('Setting up configmap watcher')
      await this.watchResource(
        '',
        'v1',
        'configmaps',
        async (e) => {
          const { object } = e
          const { metadata, data } = object as k8s.V1ConfigMap
          if (metadata && metadata.name !== 'apl-keycloak-operator-cm') return
          switch (e.type) {
            case ResourceEventType.Added:
            case ResourceEventType.Modified: {
              try {
                env.FEAT_EXTERNAL_IDP = data!.FEAT_EXTERNAL_IDP
                env.KEYCLOAK_HOSTNAME_URL = data!.KEYCLOAK_HOSTNAME_URL
                env.KEYCLOAK_ADDRESS_INTERNAL = data!.KEYCLOAK_ADDRESS_INTERNAL
                env.KEYCLOAK_REALM = data!.KEYCLOAK_REALM
                env.TEAM_IDS = JSON.parse(data!.TEAM_IDS)
                env.REDIRECT_URIS = JSON.parse(data!.REDIRECT_URIS)
                env.WAIT_OPTIONS = data!.WAIT_OPTIONS
                if (env.FEAT_EXTERNAL_IDP === 'true') {
                  env.IDP_ALIAS = data!.IDP_ALIAS
                  env.IDP_OIDC_URL = data!.IDP_OIDC_URL
                  env.IDP_GROUP_PLATFORM_ADMIN = data!.IDP_GROUP_PLATFORM_ADMIN
                  env.IDP_GROUP_ALL_TEAMS_ADMIN = data!.IDP_GROUP_ALL_TEAMS_ADMIN
                  env.IDP_GROUP_TEAM_ADMIN = data!.IDP_GROUP_TEAM_ADMIN
                  env.IDP_GROUP_MAPPINGS_TEAMS =
                    Object.keys(data!.IDP_GROUP_MAPPINGS_TEAMS).length === 0
                      ? JSON.parse(data!.IDP_GROUP_MAPPINGS_TEAMS)
                      : undefined
                  env.IDP_SUB_CLAIM_MAPPER = data!.IDP_SUB_CLAIM_MAPPER
                  env.IDP_USERNAME_CLAIM_MAPPER = data!.IDP_USERNAME_CLAIM_MAPPER
                }
                secretInitialized = true
                if (configMapInitialized) await runKeycloakUpdater()
                break
              } catch (error) {
                throw extractError('handling configmap update event', error)
              }
            }
            default:
              break
          }
        },
        'apl-keycloak-operator',
      )
      console.info('Setting up configmap watcher done')
    } catch (error) {
      throw extractError('setting up configmap watcher', error)
    }
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()

  console.info('Listening to team namespace changes in all namespaces')
  console.info('Setting up namespace prefix filter to "team-"')

  await operator.start()

  const exit = (reason: string, error?: Error) => {
    console.info('REASON OF EXIT:', reason)
    if (error) {
      console.error('ERROR DETAILS:', error)
    }
    operator.stop()
    process.exit(1) // Ensure the process exits with an error code
  }

  process.on('beforeExit', (code) => {
    console.info('BEFORE EXIT CODE:', code)
  })

  process.on('exit', (code) => {
    console.info('EXIT CODE:', code)
  })

  process.on('uncaughtException', (error) => {
    console.error('UNCAUGHT EXCEPTION:', error)
    exit('uncaughtException', error)
  })

  process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason)
    exit('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)))
  })

  process.on('SIGTERM', () => exit('SIGTERM'))
  process.on('SIGINT', () => exit('SIGINT'))
}

if (typeof require !== 'undefined' && require.main === module) {
  // Ensure main is called and log any errors during the initial startup
  main().catch((error) => {
    console.error('Failed to start operator:', error)
    process.exit(1)
  })
}
async function keycloakConfigMapChanges(api: KeycloakApi) {
  await keycloakRealmProviderConfigurer(api)
  if (env.FEAT_EXTERNAL_IDP === 'true') await externalIDP(api)
  else await internalIdp(api)
}

async function createKeycloakConnection(): Promise<KeycloakConnection> {
  const basePath = env.KEYCLOAK_HOSTNAME_URL
  let token: TokenSet
  try {
    custom.setHttpOptionsDefaults({ headers: { host: env.KEYCLOAK_HOSTNAME_URL.replace('https://', '') } })
    const keycloakIssuer = await Issuer.discover(`${basePath}/realms/${env.KEYCLOAK_REALM}/`)
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
    throw extractError('creating Keycloak connection', error)
  }
}

function setupKeycloakApi(connection: KeycloakConnection) {
  const { basePath, token } = connection
  const auth = new HttpBearerAuth()
  auth.accessToken = String(token.access_token)
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
    groups: new GroupsApi(basePath),
  }
  forEach(api, (a) => a.setDefaultAuthentication(auth))
  return api
}

async function keycloakRealmProviderConfigurer(api: KeycloakApi) {
  // Create realm 'otomi'
  const realmConf = createRealm(keycloakRealm)
  realmConf.ssoSessionIdleTimeout = env.KC_SESSION_IDLE_TIMEOUT
  realmConf.ssoSessionMaxLifespan = env.KC_SESSION_MAX_LIFESPAN
  realmConf.accessTokenLifespan = env.KC_ACCESS_TOKEN_LIFESPAN
  realmConf.accessTokenLifespanForImplicitFlow = env.KC_ACCESS_TOKEN_LIFESPAN_FOR_IMPLICIT_FLOW
  realmConf.offlineSessionMaxLifespanEnabled = env.KC_OFFLINE_SESSION_MAX_LIFESPAN_ENABLED
  realmConf.offlineSessionIdleTimeout = env.KC_OFFLINE_SESSION_IDLE_TIMEOUT
  realmConf.offlineSessionMaxLifespan = env.KC_OFFLINE_SESSION_MAX_LIFESPAN
  // the api does not offer a list method, and trying to get by id throws an error
  // which we wan to discard, so we run the next command with an empty errors array
  console.info(`Getting realm ${keycloakRealm}`)
  try {
    const existingRealm = (await api.realms.adminRealmsRealmGet(keycloakRealm)).body
    if (isObjectSubsetDifferent(realmConf, existingRealm)) {
      console.info(`Updating realm ${keycloakRealm}`)
      await api.realms.adminRealmsRealmPut(keycloakRealm, realmConf)
    } else {
      console.info(`Realm ${keycloakRealm} does not require updating`)
    }
  } catch (error) {
    if (error.statusCode === 404) {
      console.info(`Creating realm ${keycloakRealm}`)
      await api.realms.adminRealmsPost(realmConf as RequestFile)
    } else {
      throw error
    }
  }

  // Create Client Scopes
  const scope = createClientScopes()
  console.info('Getting openid client scope')
  const clientScopes = (await api.clientScope.adminRealmsRealmClientScopesGet(keycloakRealm)).body
  const existingScope = clientScopes.find((el) => el.name === scope.name)
  if (existingScope) {
    console.info('Updating openid client scope')
    // @NOTE this PUT operation is almost pointless as it is not updating deep nested properties because of various db constraints
    await api.clientScope.adminRealmsRealmClientScopesClientScopeIdPut(keycloakRealm, existingScope.id!, scope)
  } else {
    console.info('Creating openid client scope')
    await api.clientScope.adminRealmsRealmClientScopesPost(keycloakRealm, scope)
  }

  const teamRoles = mapTeamsToRoles(
    env.TEAM_IDS,
    env.IDP_GROUP_MAPPINGS_TEAMS,
    env.IDP_GROUP_TEAM_ADMIN,
    env.IDP_GROUP_ALL_TEAMS_ADMIN,
    env.IDP_GROUP_PLATFORM_ADMIN,
    env.KEYCLOAK_REALM,
  )
  console.info(`Getting all roles from realm ${keycloakRealm}`)
  const existingRealmRoles = (await api.roles.adminRealmsRealmRolesGet(keycloakRealm)).body
  await Promise.all(
    teamRoles.map((role) => {
      const exists = existingRealmRoles.some((el) => el.name === role.name)
      if (exists) {
        console.info(`Updating role ${role.name!}`)
        return api.roles.adminRealmsRealmRolesRoleNamePut(keycloakRealm, role.name ?? '', role)
      }
      console.info(`Creating role ${role.name!}`)
      return api.roles.adminRealmsRealmRolesPost(keycloakRealm, role)
    }),
  )

  // Create Otomi Client
  const uniqueUrls = [...new Set(env.REDIRECT_URIS)]
  const client = createClient(uniqueUrls, env.KEYCLOAK_HOSTNAME_URL, env.KEYCLOAK_CLIENT_SECRET)
  console.info('Getting otomi client')
  const allClients = (await api.clients.adminRealmsRealmClientsGet(keycloakRealm)).body
  const existingClient = allClients.find((el) => el.name === client.name)
  if (existingClient) {
    if (isObjectSubsetDifferent(client, existingClient)) {
      console.info('Updating otomi client')
      await api.clients.adminRealmsRealmClientsClientUuidPut(keycloakRealm, existingClient.id!, client)
    } else {
      console.info(`Client otomi does not require updating`)
    }
  } else {
    console.info('Creating otomi client')
    await api.clients.adminRealmsRealmClientsPost(keycloakRealm, client)
  }

  console.info('Getting client claim mappers')
  const allClaims =
    (await api.protocols.adminRealmsRealmClientsClientUuidProtocolMappersModelsGet(keycloakRealm, client.id!)).body ||
    []
  if (!allClaims.some((el) => el.name === 'email')) {
    const emailMapper = createClientEmailClaimMapper()
    console.info('Creating client email claim mapper')
    await api.protocols.adminRealmsRealmClientsClientUuidProtocolMappersModelsPost(
      keycloakRealm,
      client.id!,
      emailMapper,
    )
  }
  if (!allClaims.some((el) => el.name === 'sub')) {
    const subMapper = createClientSubClaimMapper()
    console.info('Creating client sub claim mapper')
    await api.protocols.adminRealmsRealmClientsClientUuidProtocolMappersModelsPost(keycloakRealm, client.id!, subMapper)
  }

  // set login theme for master realm
  console.info('adding theme for login page')
  await api.realms.adminRealmsRealmPut(env.KEYCLOAK_REALM, createLoginThemeConfig('APL'))
}

async function externalIDP(api: KeycloakApi) {
  // Keycloak acts as broker
  // Create Identity Provider
  const idp = await createIdProvider(env.IDP_CLIENT_ID, env.IDP_ALIAS, env.IDP_CLIENT_SECRET, env.IDP_OIDC_URL)

  console.info('Geting identity provider')
  const existingProviders = (await api.providers.adminRealmsRealmIdentityProviderInstancesGet(keycloakRealm)).body || []

  if (existingProviders.some((el) => el.alias === idp.alias)) {
    console.info('Updating identity provider')
    await api.providers.adminRealmsRealmIdentityProviderInstancesAliasPut(keycloakRealm, idp.alias!, idp)
  } else {
    console.info('Creating identity provider')
    await api.providers.adminRealmsRealmIdentityProviderInstancesPost(keycloakRealm, idp)
  }

  // Create Identity Provider Mappers
  const idpMappers = createIdpMappers(
    env.IDP_ALIAS,
    env.IDP_GROUP_MAPPINGS_TEAMS,
    env.IDP_GROUP_PLATFORM_ADMIN,
    env.IDP_GROUP_ALL_TEAMS_ADMIN,
    env.IDP_GROUP_TEAM_ADMIN,
    env.IDP_USERNAME_CLAIM_MAPPER,
    env.IDP_SUB_CLAIM_MAPPER,
  )

  console.info('Getting role mappers')
  const existingMappers = (
    await api.providers.adminRealmsRealmIdentityProviderInstancesAliasMappersGet(keycloakRealm, env.IDP_ALIAS)
  ).body

  try {
    await Promise.all(
      idpMappers.map((idpMapper) => {
        const existingMapper = existingMappers.find((m) => m.name === idpMapper.name)
        if (existingMapper) {
          console.info(`Updating mapper ${idpMapper.name!}`)
          return api.providers.adminRealmsRealmIdentityProviderInstancesAliasMappersIdPut(
            keycloakRealm,
            env.IDP_ALIAS,
            existingMapper.id!,
            {
              ...existingMapper,
              ...idpMapper,
            },
          )
        }
        console.info(`Creating mapper ${idpMapper.name!}`)
        return api.providers.adminRealmsRealmIdentityProviderInstancesAliasMappersPost(
          keycloakRealm,
          env.IDP_ALIAS,
          idpMapper,
        )
      }),
    )
    console.info('Finished external IDP')
  } catch (error) {
    throw extractError('setting up external IDP', error)
  }
}

async function internalIdp(api: KeycloakApi) {
  // IDP instead of broker
  console.info('Getting realm groups')
  const updatedExistingGroups = (await api.groups.adminRealmsRealmGroupsGet(keycloakRealm)).body

  // get updated existing roles
  console.info(`Getting all roles from realm ${keycloakRealm}`)
  const updatedExistingRealmRoles = (await api.roles.adminRealmsRealmRolesGet(keycloakRealm)).body

  // get clients for access roles
  console.info(`Getting client realm-management from realm ${keycloakRealm}`)
  const realmManagementClients = (await api.clients.adminRealmsRealmClientsGet(keycloakRealm, 'realm-management')).body
  const realmManagementClient = realmManagementClients.find((el) => el.clientId === 'realm-management')!

  console.info(`Getting realm-management roles from realm ${keycloakRealm}`)
  const realmManagementRoles = (
    await api.roles.adminRealmsRealmClientsClientUuidRolesGet(keycloakRealm, realmManagementClient.id!)
  ).body
  const realmManagementRole = realmManagementRoles.find((el) => el.name === 'manage-realm')!
  const userManagementRole = realmManagementRoles.find((el) => el.name === 'manage-users')!
  const userViewerRole = realmManagementRoles.find((el) => el.name === 'view-users')!

  // attach roles to groups
  await Promise.all(
    updatedExistingGroups.map(async (group) => {
      const groupName = group.name!
      // get realm roles for group
      console.info(`Getting all roles from realm ${keycloakRealm} for group ${groupName}`)
      const existingRoleMappings = (
        await api.roleMapper.adminRealmsRealmGroupsGroupIdRoleMappingsRealmGet(keycloakRealm, group.id!)
      ).body
      const existingRoleMapping = existingRoleMappings.find((el) => el.name === groupName)
      if (!existingRoleMapping) {
        // set realm roles
        const roles: RoleRepresentation[] = []
        const existingRole = updatedExistingRealmRoles.find(
          (el) => el.name === (groupName === 'otomi-admin' ? 'platform-admin' : groupName),
        )
        if (existingRole) {
          roles.push(existingRole)
        }
        console.info(`Creating role mapping for group ${groupName}`)
        await api.roleMapper.adminRealmsRealmGroupsGroupIdRoleMappingsRealmPost(keycloakRealm, group.id!, roles)
      }
      // get client roles for group
      console.info(`Getting all client roles from realm ${keycloakRealm} for group ${groupName}`)
      const existingClientRoleMappings = (
        await api.clientRoleMappings.adminRealmsRealmGroupsGroupIdRoleMappingsClientsClientIdGet(
          keycloakRealm,
          group.id!,
          realmManagementClient.id!,
        )
      ).body
      const existingClientRoleMapping = existingClientRoleMappings.find((el) => el.name === groupName)
      if (!existingClientRoleMapping) {
        // let team members see other users
        const accessRoles: RoleRepresentation[] = [userViewerRole]
        // both platform-admin and all-teams-admin role will get access to manage users
        // so the platform-admin can login to the 'otomi' realm just like all-teams-admin and see the same
        if (groupName === 'all-teams-admin') accessRoles.push(userManagementRole)
        if (groupName === 'platform-admin') accessRoles.push(realmManagementRole)
        console.info(
          `Creating access roles [${accessRoles.map((r) => r.name).join(',')}] mapping for group ${groupName}`,
        )
        await api.clientRoleMappings.adminRealmsRealmGroupsGroupIdRoleMappingsClientsClientIdPost(
          keycloakRealm,
          group.id!,
          realmManagementClient.id!,
          accessRoles,
        )
      }
    }),
  )

  // Create default admin user in realm 'otomi'
  await createUpdateUser(api, createAdminUser(env.KEYCLOAK_ADMIN, env.KEYCLOAK_ADMIN_PASSWORD))
}

async function manageGroups(api: KeycloakApi) {
  const teamGroups = createGroups(env.TEAM_IDS)
  console.info('Getting realm groups')
  try {
    const existingGroups = (await api.groups.adminRealmsRealmGroupsGet(keycloakRealm)).body
    await Promise.all(
      teamGroups.map((group) => {
        const groupName = group.name!
        const existingGroup = existingGroups.find((el) => el.name === groupName)
        if (existingGroup) {
          console.info(`Updating groups ${groupName}`)
          return api.groups.adminRealmsRealmGroupsGroupIdPut(keycloakRealm, existingGroup.id!, group)
        }
        console.info(`Creating group ${groupName}`)
        return api.groups.adminRealmsRealmGroupsPost(keycloakRealm, group)
      }),
    )
    console.info('Finished managing groups')
  } catch (error) {
    throw extractError('managing groups', error)
  }
}

export async function updateUserGroups(
  api: KeycloakApi,
  user: UserRepresentation,
  groupsByName: Record<string, string>,
  teamGroups: string[],
): Promise<void> {
  const userId = user.id!
  const { body: existingUserGroups } = await api.users.adminRealmsRealmUsersUserIdGroupsGet(keycloakRealm, userId)
  const userGroupIds: Set<string> = new Set(existingUserGroups.map((userGroup) => groupsByName[userGroup.name!]))
  const teamGroupIds: Set<string> = new Set()
  let groupUpdates = 0
  await Promise.all(
    teamGroups.map(async (teamGroup): Promise<void> => {
      const teamGroupId = groupsByName[teamGroup]
      if (teamGroupId) {
        if (!userGroupIds.has(teamGroupId)) {
          console.info(`Adding user ${user.email} to ${teamGroup}`)
          await api.users.adminRealmsRealmUsersUserIdGroupsGroupIdPut(keycloakRealm, userId, teamGroupId)
          groupUpdates += 1
        }
        teamGroupIds.add(teamGroupId)
      } else {
        console.info(`Group ${teamGroup} does not exist, skipping assignment`)
      }
    }),
  )
  await Promise.all(
    existingUserGroups.map(async (userGroup): Promise<void> => {
      const userGroupId = groupsByName[userGroup.name!]
      if (!teamGroupIds.has(userGroupId)) {
        console.info(`Removing user ${user.email} from ${userGroup.name}`)
        await api.users.adminRealmsRealmUsersUserIdGroupsGroupIdDelete(keycloakRealm, userId, userGroupId)
        groupUpdates += 1
      }
    }),
  )
  if (!groupUpdates) {
    console.log(`No groups updated for user ${user.email}`)
  }
}

async function createUpdateUser(api: KeycloakApi, userConf: UserRepresentation): Promise<void> {
  const { email, groups } = userConf
  console.info(`Getting users for ${email}`)
  const existingUsersByUserEmail = (await api.users.adminRealmsRealmUsersGet(keycloakRealm, false, email)).body
  const existingUser = existingUsersByUserEmail?.[0]
  const existingGroups = (await api.groups.adminRealmsRealmGroupsGet(keycloakRealm)).body
  const groupsByName = Object.fromEntries(existingGroups.map((group) => [group.name, group.id])) as Record<
    string,
    string
  >
  try {
    if (existingUser) {
      const omitUpdateFields = ['realmRoles', 'initialPassword', 'requiredActions', 'groups']
      if (!existingUser.requiredActions?.includes('UPDATE_PASSWORD')) omitUpdateFields.push('credentials')
      const updatedUserConf = omit(userConf, omitUpdateFields)
      if (isObjectSubsetDifferent(updatedUserConf, existingUser)) {
        console.info(`Updating user ${email}`)
        await api.users.adminRealmsRealmUsersUserIdPut(keycloakRealm, existingUser.id!, updatedUserConf)
      } else {
        console.info(`User with email ${email} does not require updating`)
      }
      await updateUserGroups(api, existingUser, groupsByName, groups || [])
    } else {
      console.info(`Creating user ${email}`)
      for (let i = (userConf.groups?.length || 0) - 1; i >= 0; i--) {
        const groupName = userConf.groups![i]
        if (!(groupName in groupsByName)) {
          console.info(`Group ${groupName} does not exist, skipping assignment`)
          userConf.groups!.splice(i, 1)
        }
      }
      await api.users.adminRealmsRealmUsersPost(keycloakRealm, userConf)
    }
  } catch (error) {
    throw extractError('creating or updating user', error)
  }
}

async function deleteUsers(api: any, users: any[]) {
  const { body: keycloakUsers } = await api.users.adminRealmsRealmUsersGet(keycloakRealm)
  const filteredUsers = keycloakUsers.filter((user) => user.username !== 'otomi-admin')
  const usersToDelete = filteredUsers.filter((user) => !users.some((u) => u.email === user.email))

  await Promise.all(
    usersToDelete.map(async (user) => {
      try {
        await api.users.adminRealmsRealmUsersUserIdDelete(keycloakRealm, user.id)
        console.debug(`Deleted user ${user.email}`)
      } catch (error) {
        throw extractError(`deleting user ${user.email}`, error)
      }
    }),
  )
}

async function manageUsers(api: KeycloakApi, users: Record<string, any>[]) {
  // Create/Update users in realm 'otomi'
  await Promise.all(
    users.map((user) =>
      createUpdateUser(
        api,
        createTeamUser(user.email, user.firstName, user.lastName, user.groups, user.initialPassword),
      ),
    ),
  )
  // Delete users not in users list
  await deleteUsers(api, users)
}
