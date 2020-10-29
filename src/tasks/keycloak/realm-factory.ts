/* eslint-disable @typescript-eslint/ban-types */
import * as api from '@redkubes/keycloak-client-node'
import * as utils from '../../utils'
import { defaultsDeep } from 'lodash'
import {
  cleanEnv,
  TENANT_ID,
  TENANT_CLIENT_ID,
  TENANT_CLIENT_SECRET,
  IDP_ALIAS,
  KEYCLOAK_CLIENT_SECRET,
  KEYCLOAK_REALM,
  REDIRECT_URIS,
  IDP_GROUP_OTOMI_ADMIN,
  IDP_GROUP_TEAM_ADMIN,
  IDP_GROUP_MAPPINGS_TEAMS,
  IDP_OIDC_URL,
} from '../../validators'

import {
  roleTpl,
  idpMapperTpl,
  defaultsIdpMapperTpl,
  protocolMappersList,
  idpProviderCfgTpl,
  clientScopeCfgTpl,
  otomiClientCfgTpl,
  TeamMapping,
  clientEmailClaimMapper,
} from './config'

const env = cleanEnv({
  TENANT_ID,
  TENANT_CLIENT_ID,
  TENANT_CLIENT_SECRET,
  IDP_ALIAS,
  KEYCLOAK_CLIENT_SECRET,
  KEYCLOAK_REALM,
  REDIRECT_URIS,
  IDP_GROUP_OTOMI_ADMIN,
  IDP_GROUP_TEAM_ADMIN,
  IDP_GROUP_MAPPINGS_TEAMS,
  IDP_OIDC_URL,
})

export function createClient(): api.ClientRepresentation {
  const redirectUris: Array<string> = env.REDIRECT_URIS
  const secret = env.KEYCLOAK_CLIENT_SECRET
  const otomiClientRepresentation = defaultsDeep(
    new api.ClientRepresentation(),
    otomiClientCfgTpl(secret, redirectUris),
  )
  return otomiClientRepresentation
}

export function createIdpMappers(): Array<api.IdentityProviderMapperRepresentation> {
  const idpAlias = env.IDP_ALIAS
  const teams = env.IDP_GROUP_MAPPINGS_TEAMS
  const adminGroupMapping = env.IDP_GROUP_OTOMI_ADMIN
  const teamAdminGroupMapping = env.IDP_GROUP_TEAM_ADMIN
  // admin idp mapper case
  const admin = idpMapperTpl('map otomi-admin group to role', idpAlias, 'admin', adminGroupMapping)
  const adminMapper = defaultsDeep(new api.IdentityProviderMapperRepresentation(), admin)
  // team admin idp mapper case
  const teamAdmin = idpMapperTpl('map team-admin group to role', idpAlias, 'team-admin', teamAdminGroupMapping)
  const teamAdminMapper = defaultsDeep(new api.IdentityProviderMapperRepresentation(), teamAdmin)
  // default idp mappers case
  const defaultIdps = defaultsIdpMapperTpl(idpAlias)
  const defaultMapper = defaultIdps.map((idpMapper) => {
    return defaultsDeep(new api.IdentityProviderMapperRepresentation(), idpMapper)
  })
  // team idp case - team list extracted from IDP_GROUP_MAPPINGS_TEAMS env
  const teamList = utils.objectToArray(teams, 'name', 'groupMapping') as TeamMapping[]
  const teamMappers = teamList.map((team) => {
    const teamMapper = idpMapperTpl(`map ${team.name} group to role`, idpAlias, team.name, team.groupMapping)
    return defaultsDeep(new api.IdentityProviderMapperRepresentation(), teamMapper)
  })
  return teamMappers.concat(defaultMapper).concat(adminMapper).concat(teamAdminMapper)
}

export async function createIdProvider(): Promise<api.IdentityProviderRepresentation> {
  const tenantId = env.TENANT_ID
  const clientId = env.TENANT_CLIENT_ID
  const alias = env.IDP_ALIAS
  const clientSecret = env.TENANT_CLIENT_SECRET
  const oidcUrl = env.IDP_OIDC_URL
  const otomiClientIdp = defaultsDeep(
    new api.IdentityProviderRepresentation(),
    await idpProviderCfgTpl(alias, tenantId, clientId, clientSecret, oidcUrl),
  )
  return otomiClientIdp
}

export function createProtocolMappersForClientScope(): Array<api.ProtocolMapperRepresentation> {
  const protocolMapperRepresentations = protocolMappersList.map((protoMapper) => {
    return defaultsDeep(new api.ProtocolMapperRepresentation(), protoMapper)
  })
  return protocolMapperRepresentations
}

export function createClientEmailClaimMapper(): api.ProtocolMapperRepresentation {
  const emailClaimMapper = defaultsDeep(new api.ProtocolMapperRepresentation(), clientEmailClaimMapper())
  return emailClaimMapper
}

export function createClientScopes(): api.ClientScopeRepresentation {
  const clientScopeRepresentation = defaultsDeep(
    new api.ClientScopeRepresentation(),
    clientScopeCfgTpl(createProtocolMappersForClientScope()),
  )
  return clientScopeRepresentation
}

export function mapTeamsToRoles(): Array<api.RoleRepresentation> {
  const teams = env.IDP_GROUP_MAPPINGS_TEAMS
  const realm = env.KEYCLOAK_REALM
  // create static admin teams
  const otomiAdmin = Object.create({ name: 'otomi-admin', groupMapping: env.IDP_GROUP_OTOMI_ADMIN }) as TeamMapping
  const teamAdmin = Object.create({ name: 'team-admin', groupMapping: env.IDP_GROUP_TEAM_ADMIN }) as TeamMapping
  const adminTeams = [otomiAdmin, teamAdmin]
  // iterate through all the teams and map groups
  const teamList = utils.objectToArray(teams, 'name', 'groupMapping') as TeamMapping[]
  const teamRoleRepresentations = adminTeams.concat(teamList).map((team) => {
    const role = roleTpl(team.name, team.groupMapping, realm)
    const roleRepresentation = defaultsDeep(new api.RoleRepresentation(), role)
    return roleRepresentation
  })
  return teamRoleRepresentations
}

export function createLoginThemeConfig(loginTheme = 'otomi'): api.RealmRepresentation {
  return defaultsDeep(new api.RealmRepresentation(), { loginTheme })
}
