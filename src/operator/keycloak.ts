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
  RealmRepresentation,
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
  KEYCLOAK_TOKEN_OFFLINE_MAX_TTL_ENABLED,
  KEYCLOAK_TOKEN_OFFLINE_TTL,
  KEYCLOAK_TOKEN_TTL,
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

const localEnv = cleanEnv({ KEYCLOAK_TOKEN_TTL, KEYCLOAK_TOKEN_OFFLINE_TTL, KEYCLOAK_TOKEN_OFFLINE_MAX_TTL_ENABLED })

const env = {
  FIRST_RUN: false,
  FEAT_EXTERNAL_IDP: 'false',
  IDP_ALIAS: '',
  IDP_OIDC_URL: '',
  IDP_CLIENT_ID: '',
  IDP_CLIENT_SECRET: '',
  IDP_GROUP_OTOMI_ADMIN: '',
  IDP_GROUP_TEAM_ADMIN: '',
  IDP_GROUP_MAPPINGS_TEAMS: [] as string[],
  IDP_SUB_CLAIM_MAPPER: '',
  IDP_USERNAME_CLAIM_MAPPER: '',
  KEYCLOAK_ADDRESS_INTERNAL: '',
  KEYCLOAK_ADMIN: '',
  KEYCLOAK_ADMIN_PASSWORD: '',
  KEYCLOAK_CLIENT_SECRET: '',
  KEYCLOAK_HOSTNAME_URL: '',
  KEYCLOAK_REALM: '',
  KEYCLOAK_TOKEN_TTL: localEnv.KEYCLOAK_TOKEN_TTL,
  KEYCLOAK_TOKEN_OFFLINE_MAX_TTL_ENABLED: localEnv.KEYCLOAK_TOKEN_OFFLINE_MAX_TTL_ENABLED,
  KEYCLOAK_TOKEN_OFFLINE_TTL: localEnv.KEYCLOAK_TOKEN_OFFLINE_TTL,
  REDIRECT_URIS: [] as string[],
  TEAM_IDS: [] as string[],
  WAIT_OPTIONS: {},
}

const kc = new KubeConfig()
// loadFromCluster when deploying on cluster
// loadFromDefault when locally connecting to cluster
if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
  kc.loadFromCluster()
} else {
  kc.loadFromDefault()
}
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

async function runKeycloakUpdater(key: string) {
  if (JSON.parse(env.FEAT_EXTERNAL_IDP)) {
    if (
      !env.IDP_ALIAS ||
      !env.IDP_OIDC_URL ||
      !env.IDP_CLIENT_ID ||
      !env.IDP_CLIENT_SECRET ||
      !env.IDP_GROUP_OTOMI_ADMIN ||
      !env.IDP_GROUP_TEAM_ADMIN ||
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
    !env.KEYCLOAK_TOKEN_TTL ||
    !env.WAIT_OPTIONS
  ) {
    console.info('Missing required keycloak variables for Keycloak setup/reconfiguration')
    return
  }
  switch (key) {
    case 'addTeam':
      try {
        await keycloakTeamAdded()
        break
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
        break
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
        await keycloakConfigMapChanges().then(async () => {
          await runKeycloakUpdater('addTeam')
        })
        break
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
          const { object } = e
          const { metadata, data } = object as k8s.V1Secret
          if (metadata && metadata.name !== 'keycloak-admin') return
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
                await runKeycloakUpdater('updateConfig').then(() => {
                  console.log('Updated Config')
                })
                break
              } catch (error) {
                console.debug(error)
                break
              }
            }
            default:
              break
          }
        },
        'apl-keycloak-operator',
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
          const { object } = e
          const { metadata, data } = object as k8s.V1ConfigMap
          if (metadata && metadata.name !== 'keycloak-cm') return
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
                  env.IDP_GROUP_OTOMI_ADMIN = data!.IDP_GROUP_OTOMI_ADMIN
                  env.IDP_GROUP_TEAM_ADMIN = data!.IDP_GROUP_TEAM_ADMIN
                  env.IDP_GROUP_MAPPINGS_TEAMS = JSON.parse(data!.IDP_GROUP_MAPPINGS_TEAMS)
                  env.IDP_SUB_CLAIM_MAPPER = data!.IDP_SUB_CLAIM_MAPPER
                  env.IDP_USERNAME_CLAIM_MAPPER = data!.IDP_USERNAME_CLAIM_MAPPER
                }
                await runKeycloakUpdater('updateConfig').then(() => {
                  console.log('Updated Config')
                })
                break
              } catch (error) {
                console.debug(error)
                break
              }
            }
            default:
              break
          }
        },
        'apl-keycloak-operator',
      )
      console.log('Watching configmap done!')
    } catch (error) {
      console.debug(error)
    }
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()

  console.info('Listening to team namespace changes in all namespaces')
  console.info('Setting up namespace prefix filter to "team-"')

  await operator.start()

  const exit = (reason: string, error?: Error) => {
    console.log('REASON OF EXIT:', reason)
    if (error) {
      console.error('ERROR DETAILS:', error)
    }
    operator.stop()
    process.exit(1) // Ensure the process exits with an error code
  }

  process.on('beforeExit', (code) => {
    console.log('BEFORE EXIT CODE:', code)
  })

  process.on('exit', (code) => {
    console.log('EXIT CODE:', code)
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

// async function main(): Promise<void> {
//   const operator = new MyOperator()
//   console.info(`Listening to team namespace changes in all namespaces`)
//   console.info('Setting up namespace prefix filter to "team-"')
//   await operator.start()
//   const exit = (reason: string) => {
//     console.log('REASON OF EXIT: ', reason)
//     operator.stop()
//     process.exit(0)
//   }
//   process.on('beforeExit', (error) => {
//     console.log('BEFORE EXIT ERROR: ', error)
//   })
//   process.on('exit', (error) => {
//     console.log('EXIT ERROR: ', error)
//   })
//   process.on('uncaughtException', (error) => {
//     console.log('uncaughtException ERROR: ', error)
//   })
//   process.on('unhandledRejection', (error) => {
//     console.log('unhandledRejection ERROR: ', error)
//   })
//   process.on('SIGTERM', () => exit('SIGTERM')).on('SIGINT', () => exit('SIGINT'))
// }

if (typeof require !== 'undefined' && require.main === module) {
  // Ensure main is called and log any errors during the initial startup
  main().catch((error) => {
    console.error('Failed to start operator:', error)
    process.exit(1)
  })
}
async function keycloakConfigMapChanges() {
  const connection = await createKeycloakConnection()
  const api = setupKeycloakApi(connection)
  keycloakRealmProviderConfigurer(api)
  if (env.FEAT_EXTERNAL_IDP === 'true') externalIDP(api)
  else internalIdp(api, connection)
}

async function keycloakTeamAdded() {
  const connection = await createKeycloakConnection()
  try {
    await manageGroups(connection).then(() => {
      console.log('Completed adding team')
    })
  } catch (error) {
    console.log('Error adding team: ', error)
  }
}

async function keycloakTeamDeleted() {
  const connection = await createKeycloakConnection()
  try {
    await manageGroups(connection).then(() => {
      console.log('Completed deleting team')
    })
  } catch (error) {
    console.log('Error deleting team: ', error)
  }
}

async function createKeycloakConnection(): Promise<KeycloakConnection> {
  await waitTillAvailable(env.KEYCLOAK_HOSTNAME_URL, undefined, env.WAIT_OPTIONS)
  const keycloakAddress = env.KEYCLOAK_HOSTNAME_URL
  const basePath = `${keycloakAddress}/admin/realms`
  let token: TokenSet
  try {
    custom.setHttpOptionsDefaults({ headers: { host: env.KEYCLOAK_HOSTNAME_URL.replace('https://', '') } })
    const keycloakIssuer = await Issuer.discover(`${keycloakAddress}/realms/${env.KEYCLOAK_REALM}/`)
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

  const teamRoles = mapTeamsToRoles(
    env.TEAM_IDS,
    env.IDP_GROUP_MAPPINGS_TEAMS,
    env.IDP_GROUP_TEAM_ADMIN,
    env.IDP_GROUP_OTOMI_ADMIN,
    env.KEYCLOAK_REALM,
  )
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
  const client = createClient(env.REDIRECT_URIS, env.KEYCLOAK_HOSTNAME_URL, env.KEYCLOAK_CLIENT_SECRET)
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
  const idp = await createIdProvider(env.IDP_CLIENT_ID, env.IDP_ALIAS, env.IDP_CLIENT_SECRET, env.IDP_OIDC_URL)

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
  const idpMappers = createIdpMappers(
    env.IDP_ALIAS,
    env.IDP_GROUP_MAPPINGS_TEAMS,
    env.IDP_GROUP_OTOMI_ADMIN,
    env.IDP_GROUP_TEAM_ADMIN,
    env.IDP_USERNAME_CLAIM_MAPPER,
    env.IDP_SUB_CLAIM_MAPPER,
  )

  const existingMappers = ((await doApiCall(errors, `Getting role mappers`, () =>
    api.providers.realmIdentityProviderInstancesAliasMappersGet(keycloakRealm, env.IDP_ALIAS),
  )) || []) as IdentityProviderMapperRepresentation[]

  try {
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
    console.error('Finished external IDP: ')
  } catch (error) {
    console.error('Error in external IDP: ', error)
  }
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
  try {
    if (existingUser) {
      await doApiCall(errors, `Updating user ${env.KEYCLOAK_ADMIN}`, async () =>
        api.users.realmUsersIdPut(keycloakRealm, existingUser.id as string, userConf),
      )
    } else {
      await doApiCall(errors, `Creating user ${env.KEYCLOAK_ADMIN}`, () =>
        api.users.realmUsersPost(keycloakRealm, userConf),
      )
    }
  } catch (error) {
    console.error('Error in internalIDP: ', error)
  }
}

async function manageGroups(connection: KeycloakConnection) {
  const { token, basePath } = connection
  const groups = new GroupsApi(basePath)
  const teamGroups = createGroups(env.TEAM_IDS)
  groups.accessToken = String(token.access_token)

  const existingGroups = ((await doApiCall(errors, 'Getting realm groups', () =>
    groups.realmGroupsGet(keycloakRealm),
  )) || []) as Array<GroupRepresentation>
  try {
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
    console.log('Finished managing groups')
  } catch (error) {
    console.error('Error in manageGroups: ', error)
  }
}
