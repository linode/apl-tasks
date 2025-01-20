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
  clientEmailClaimMapper,
  clientScopeCfgTpl,
  defaultsIdpMapperTpl,
  idpMapperTpl,
  idpProviderCfgTpl,
  otomiClientCfgTpl,
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
  // 1) Create the default user representation
  const userRepresentation = defaultsDeep(
    new UserRepresentation(),
    teamUserCfgTpl(email, firstName, lastName, groups, initialPassword),
  )

  // 2) Transform the email string: "demo@example.com" -> "demo-example-com"
  const transformedEmail = email.replace(/@/g, '-').replace(/\./g, '-')

  // 3) Store it in a custom user attribute
  userRepresentation.attributes = userRepresentation.attributes || {}
  userRepresentation.attributes['transformedEmail'] = transformedEmail

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
