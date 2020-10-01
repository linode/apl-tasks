import { expect } from 'chai'
import * as _ from 'lodash'
import * as api from '@redkubes/keycloak-client-node'

import {
  ClientsApi,
  IdentityProvidersApi,
  ClientScopesApi,
  RolesApi,
  ProtocolMappersApi,
} from '@redkubes/keycloak-client-node'
import * as realmConfig from './realm-factory'
import { cleanEnv, IDP_ALIAS, KEYCLOAK_ADDRESS, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID } from '../../validators'

const env = cleanEnv({
  IDP_ALIAS,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
  KEYCLOAK_CLIENT_ID,
})

import nock from 'nock'

const keycloakAddress = env.KEYCLOAK_ADDRESS
const keycloakRealm = env.KEYCLOAK_REALM
const basePath = `${keycloakAddress}/admin/realms`
const host = process.env.NODE_ENV === 'test' ? 'http://127.0.0.1:8080' : keycloakAddress
const baseAddress = process.env.NODE_ENV === 'test' ? '/dev/admin/realms' : '/admin/realms'
const token = {
  accessToken:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Ik9JREMgQXV0aGVudGljYXRpb24gdG9rZW4iLCJpYXQiOjE1MTYyMzkwMjJ9.x5RQZuUPsjIuVHmurQ4h8X3ujIUKL1BeyRRs4Ztu5-E',
}

// Configure AccessToken for service calls
const providers = new IdentityProvidersApi(basePath)
providers.accessToken = String(token.accessToken)
const clientScope = new ClientScopesApi(basePath)
clientScope.accessToken = String(token.accessToken)
const roles = new RolesApi(basePath)
roles.accessToken = String(token.accessToken)
const clients = new ClientsApi(basePath)
clients.accessToken = String(token.accessToken)
const protocols = new ProtocolMappersApi(basePath)
protocols.accessToken = String(token.accessToken)

const nockReplies = {}
function registerNockResponse(methodName, url, payload, requestType) {
  nockReplies[methodName] = { url: url, payload: payload, requestType: requestType }
  switch (requestType) {
    case 'POST':
      nock(host).persist().post(url, _.matches(payload)).reply(200, { valid: true })
      break
    case 'PUT':
      nock(host).persist().put(url, _.matches(payload)).reply(200, { valid: true })
      break
  }
}

async function createMockedData() {
  // Create Client Scopes
  registerNockResponse(
    'clientScope.realmClientScopesPost',
    `${baseAddress}/${keycloakRealm}/client-scopes`,
    _.pick(realmConfig.createClientScopes(), ['name', 'protocol', 'attributes']),
    'POST',
  )

  // Create Roles
  registerNockResponse(
    'roles.realmRolesPost',
    `${baseAddress}/${keycloakRealm}/roles`,
    realmConfig.mapTeamsToRoles().reduce((element) => {
      return _.pick(element, ['name', 'groupMapping'])
    }),
    'POST',
  )

  // Create Identity Provider
  registerNockResponse(
    'providers.realmIdentityProviderInstancesPost',
    `${baseAddress}/${keycloakRealm}/identity-provider/instances`,
    await realmConfig.createIdProvider(),
    'POST',
  )

  // Create Identity Provider Mappers
  registerNockResponse(
    'providers.realmIdentityProviderInstancesAliasMappersPost',
    `${baseAddress}/${keycloakRealm}/identity-provider/instances/${env.IDP_ALIAS}/mappers`,
    realmConfig.createIdpMappers().reduce((element) => {
      return _.pick(element, ['name', 'identityProviderAlias', 'config'])
    }),
    'POST',
  )

  // Create Otomi Client
  registerNockResponse(
    'clients.realmClientsPost',
    `${baseAddress}/${keycloakRealm}/clients`,
    _.pick(realmConfig.createClient(), ['id', 'secret']),
    'POST',
  )

  // Email claim for client protocolMappers
  registerNockResponse(
    'protocols.realmClientsIdProtocolMappersModelsPost',
    `${baseAddress}/${keycloakRealm}/clients/${env.KEYCLOAK_CLIENT_ID}/protocol-mappers/models`,
    _.pick(realmConfig.createClientEmailClaimMapper(), 'name', 'protocol', 'config'),
    'POST',
  )
  return { running: true }
}

describe('Keycloak Bootstrapping Settings', () => {
  before(async () => {
    return await createMockedData()
  })
  // Create Client Scopes
  it('Should validate POST request to create client scopes', async () => {
    const reply = await clientScope.realmClientScopesPost(keycloakRealm, realmConfig.createClientScopes())
    expect(reply.body).to.contain({ valid: true })
  })
  // Create Roles
  it('Should validate POST request to create team to role mapper', async () => {
    const role = realmConfig.mapTeamsToRoles()[0]
    const reply = await roles.realmRolesPost(keycloakRealm, role)
    expect(reply.body).to.contain({ valid: true })
  })
  // Create Identity Provider
  it('Should validate POST request to create identity provider', async () => {
    const reply = await providers.realmIdentityProviderInstancesPost(
      keycloakRealm,
      await realmConfig.createIdProvider(),
    )
    expect(reply.body).to.contain({ valid: true })
  })
  // Create Identity Provider Mappers
  it('Should validate POST request to create identity provider mapper', async () => {
    const idpMapper = realmConfig.createIdpMappers()[0]
    const reply = await providers.realmIdentityProviderInstancesAliasMappersPost(
      keycloakRealm,
      env.IDP_ALIAS,
      idpMapper,
    )
    expect(reply.body).to.contain({ valid: true })
  })
  // Create Otomi Client
  it('Should validate POST request to create realm client', async () => {
    const reply = await clients.realmClientsPost(keycloakRealm, realmConfig.createClient())
    expect(reply.body).to.contain({ valid: true })
  })
  // Email claim for client protocolMappers
  it('Should validate POST request to create email claim for client', async () => {
    const client = realmConfig.createClient()
    const reply = await protocols.realmClientsIdProtocolMappersModelsPost(
      keycloakRealm,
      client.id,
      realmConfig.createClientEmailClaimMapper(),
    )
    expect(reply.body).to.contain({ valid: true })
  })
})
