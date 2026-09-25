import {
  ClientRepresentation,
  ClientScopeRepresentation,
  GroupRepresentation,
  IdentityProviderMapperRepresentation,
  IdentityProviderRepresentation,
  ProtocolMapperRepresentation,
  RealmRepresentation,
  RoleRepresentation,
  UserRepresentation,
} from '@linode/keycloak-client-node'
import { defaultsDeep } from 'lodash'
import * as utils from '../../utils'
import {
  TeamMapping,
  adminUserCfgTpl,
  clientAudClaimMapper,
  clientEmailClaimMapper,
  clientNameClaimMapper,
  clientNicknameClaimMapper,
  clientScopeCfgTpl,
  clientSubClaimMapper,
  defaultsIdpMapperTpl,
  idpMapperTpl,
  idpProviderCfgTpl,
  otomiClientCfgTpl,
  otomiClientId,
  protocolMappersList,
  realmCfgTpl,
  roleTpl,
  teamUserCfgTpl,
} from './config'

export function createClient(redirectUris: string[], webOrigins: string, secret: string): ClientRepresentation {
  const otomiClientRepresentation = defaultsDeep(
    new ClientRepresentation(),
    otomiClientCfgTpl(secret, redirectUris, [webOrigins]),
  )
  return otomiClientRepresentation
}

/**
 * Find the client this operator manages among the realm's clients.
 *
 * Matching is on Keycloak's identity fields -- `id` (pinned by otomiClientCfgTpl)
 * and `clientId` (the same value, and unique per realm). It deliberately does NOT
 * match on `name`.
 *
 * The previous lookup was `allClients.find((el) => el.name === client.name)`, and
 * because otomiClientCfgTpl sets no `name`, that expression evaluated to "the
 * first client in the realm with no name". That is correct only while this client
 * is the only nameless one, which nothing in the realm enforces: any client
 * created through the admin API without a `name` -- by an operator in the console,
 * or by external tooling that provisions its own OIDC client -- silently captures
 * the lookup if its clientId sorts earlier.
 *
 * The consequence is severe and effectively invisible. The operator then PUTs this
 * client's representation, including `authorizationServicesEnabled: true`, onto
 * the intruder. If that client is public, Keycloak rejects it:
 *
 *     Only confidential clients are allowed to set authorization settings
 *
 * The 500 rolls the transaction back, so nothing in the realm drifts and nothing
 * looks wrong afterwards -- but keycloakRealmProviderConfigurer aborts at this
 * step on every 30s retry and never reaches IDPManager -> manageUsers. Users added
 * in the APL console are never written to the realm, and logins fail with
 * `user_not_found` for accounts that plainly exist in the `apl-users` namespace.
 * Diagnosing that from the symptom takes a while; the operator log shows only a
 * repeating "Updating otomi client" followed by a 500.
 */
export function findManagedClient(
  allClients: ClientRepresentation[],
  clientId: string = otomiClientId,
): ClientRepresentation | undefined {
  return allClients.find((el) => el.id === clientId || el.clientId === clientId)
}

export function createGroups(teamIds: string[]): Array<GroupRepresentation> {
  const groupNames: string[] = teamIds
    .map((id) => `team-${id}`)
    .concat(['platform-admin', 'all-teams-admin', 'team-admin'])
  const groups = groupNames.map((name) => defaultsDeep(new GroupRepresentation(), { name }))
  return groups
}

export function createIdpMappers(
  idpAlias: string,
  teams: {} | undefined,
  platformAdminGroupMapping: string,
  allTeamsAdminGroupMapping: string,
  teamAdminGroupMapping: string,
  userClaimMapper: string,
  idpSubClaimMapper: string,
): Array<IdentityProviderMapperRepresentation> {
  // platform admin idp mapper case
  const platformAdmin = idpMapperTpl(
    'platform-admin group to role',
    idpAlias,
    'platform-admin',
    platformAdminGroupMapping,
  )
  const platformAdminMapper = defaultsDeep(new IdentityProviderMapperRepresentation(), platformAdmin)
  // all teams admin idp mapper case
  const allTeamsAdmin = idpMapperTpl(
    'all-teams-admin group to role',
    idpAlias,
    'all-teams-admin',
    allTeamsAdminGroupMapping,
  )
  const allTeamsAdminMapper = defaultsDeep(new IdentityProviderMapperRepresentation(), allTeamsAdmin)
  // team admin idp mapper case
  const teamAdmin = idpMapperTpl('team-admin group to role', idpAlias, 'team-admin', teamAdminGroupMapping)
  const teamAdminMapper = defaultsDeep(new IdentityProviderMapperRepresentation(), teamAdmin)
  // default idp mappers case
  const defaultIdps = defaultsIdpMapperTpl(idpAlias, userClaimMapper, idpSubClaimMapper)

  const defaultMapper = defaultIdps.map((idpMapper) =>
    defaultsDeep(new IdentityProviderMapperRepresentation(), idpMapper),
  )
  // team idp case - team list extracted from IDP_GROUP_MAPPINGS_TEAMS env
  const teamList = utils.objectToArray(teams || [], 'name', 'groupMapping') as TeamMapping[]
  const teamMappers = teamList.map((team) => {
    const teamMapper = idpMapperTpl(`${team.name} group to role`, idpAlias, team.name, team.groupMapping)
    return defaultsDeep(new IdentityProviderMapperRepresentation(), teamMapper)
  })
  return teamMappers
    .concat(defaultMapper)
    .concat(platformAdminMapper)
    .concat(allTeamsAdminMapper)
    .concat(teamAdminMapper)
}

export async function createIdProvider(
  clientId: string,
  alias: string,
  clientSecret: string,
  oidcUrl: string,
): Promise<IdentityProviderRepresentation> {
  const otomiClientIdp = defaultsDeep(
    new IdentityProviderRepresentation(),
    await idpProviderCfgTpl(alias, clientId, clientSecret, oidcUrl),
  )
  return otomiClientIdp
}

export function createProtocolMappersForClientScope(): Array<ProtocolMapperRepresentation> {
  const protocolMapperRepresentations = protocolMappersList.map((protoMapper) =>
    defaultsDeep(new ProtocolMapperRepresentation(), protoMapper),
  )
  return protocolMapperRepresentations
}

export function createClientEmailClaimMapper(): ProtocolMapperRepresentation {
  const emailClaimMapper = defaultsDeep(new ProtocolMapperRepresentation(), clientEmailClaimMapper())
  return emailClaimMapper
}

export function createClientSubClaimMapper(): ProtocolMapperRepresentation {
  const subClaimMapper = defaultsDeep(new ProtocolMapperRepresentation(), clientSubClaimMapper())
  return subClaimMapper
}

export function createClientNameClaimMapper(): ProtocolMapperRepresentation {
  const nameClaimMapper = defaultsDeep(new ProtocolMapperRepresentation(), clientNameClaimMapper())
  return nameClaimMapper
}

export function createClientNicknameClaimMapper(): ProtocolMapperRepresentation {
  const nicknameClaimMapper = defaultsDeep(new ProtocolMapperRepresentation(), clientNicknameClaimMapper())
  return nicknameClaimMapper
}

export function createClientAudClaimMapper(): ProtocolMapperRepresentation {
  const audClaimMapper = defaultsDeep(new ProtocolMapperRepresentation(), clientAudClaimMapper())
  return audClaimMapper
}

export function createAdminUser(username: string, password: string): UserRepresentation {
  const userRepresentation = defaultsDeep(new UserRepresentation(), adminUserCfgTpl(username, password))
  return userRepresentation
}
export function createTeamUser(
  email: string,
  firstName: string,
  lastName: string,
  groups: string[],
  initialPassword: string,
): UserRepresentation {
  const userRepresentation = defaultsDeep(
    new UserRepresentation(),
    teamUserCfgTpl(email, firstName, lastName, groups, initialPassword),
  )
  return userRepresentation
}

export function createRealm(realm: string): RealmRepresentation {
  const realmRepresentation = defaultsDeep(new RealmRepresentation(), realmCfgTpl(realm))
  return realmRepresentation
}

export function createClientScopes(): ClientScopeRepresentation {
  const clientScopeRepresentation = defaultsDeep(
    new ClientScopeRepresentation(),
    clientScopeCfgTpl(createProtocolMappersForClientScope()),
  )
  return clientScopeRepresentation
}

export function mapTeamsToRoles(
  teamIds: string[],
  idpGroupMappings: {} | undefined,
  idpGroupTeamAdmin: string,
  idpGroupAllTeamsAdmin: string,
  idpGroupPlatformAdmin: string,
  realm: string,
): Array<RoleRepresentation> {
  // eslint-disable-next-line no-param-reassign
  if (idpGroupMappings && Object.keys(idpGroupMappings).length === 0) idpGroupMappings = undefined
  const teams =
    idpGroupMappings ??
    teamIds.reduce((memo: any, name) => {
      memo[`team-${name}`] = undefined
      return memo
    }, {})
  // create static admin teams
  const teamAdmin = Object.create({ name: 'team-admin', groupMapping: idpGroupTeamAdmin }) as TeamMapping
  const allTeamsAdmin = Object.create({ name: 'all-teams-admin', groupMapping: idpGroupAllTeamsAdmin }) as TeamMapping
  const adminTeams = [teamAdmin, allTeamsAdmin]

  const otomiAdmin = Object.create({
    name: 'platform-admin',
    groupMapping: idpGroupPlatformAdmin,
  }) as TeamMapping
  adminTeams.push(otomiAdmin)
  // iterate through all the teams and map groups
  const teamList = utils.objectToArray(teams || [], 'name', 'groupMapping') as TeamMapping[]
  const teamRoleRepresentations = adminTeams.concat(teamList).map((team) => {
    const role = roleTpl(team.name, team.groupMapping, realm)
    const roleRepresentation = defaultsDeep(new RoleRepresentation(), role)
    return roleRepresentation
  })
  return teamRoleRepresentations
}

export function createLoginThemeConfig(loginTheme = 'APL'): RealmRepresentation {
  return defaultsDeep(new RealmRepresentation(), { loginTheme })
}
