import { expect } from 'chai'
import * as _ from 'lodash'
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
const baseAddress = '/dev/admin/realms'
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
function createNockReplyObject(methodName, url, payload, requestType) {
  nockReplies[methodName] = { url: url, payload: payload, requestType: requestType }
  switch (requestType) {
    case 'POST':
      // @TODO fix POST request body partial matches
      nock('http://127.0.0.1:8080')
        .persist()
        .post(
          url,
          //    _.matches(payload)
        )
        .reply(200, { valid: true })
      break
    case 'PUT':
      nock(keycloakAddress).persist().put(url, _.matches(payload)).reply(200, { valid: true })
      break
  }
}

async function createMockedData() {
  // Create Client Scopes
  createNockReplyObject(
    'clientScope.realmClientScopesPost',
    `${baseAddress}/${keycloakRealm}/client-scopes`,
    realmConfig.createClientScopes(),
    'POST',
  )

  // Create Roles
  createNockReplyObject(
    'roles.realmRolesPost',
    `${baseAddress}/${keycloakRealm}/roles`,
    realmConfig.createClientScopes(),
    'POST',
  )

  // Create Identity Provider
  createNockReplyObject(
    'providers.realmIdentityProviderInstancesPost',
    `${baseAddress}/${keycloakRealm}/identity-provider/instances`,
    await realmConfig.createIdProvider(),
    'POST',
  )

  // Create Identity Provider Mappers
  createNockReplyObject(
    'providers.realmIdentityProviderInstancesAliasMappersPost',
    `${baseAddress}/${keycloakRealm}/identity-provider/instances/${env.IDP_ALIAS}/mappers`,
    realmConfig.createIdpMappers(),
    'POST',
  )

  // Create Otomi Client
  createNockReplyObject(
    'clients.realmClientsPost',
    `${baseAddress}/${keycloakRealm}/clients`,
    realmConfig.createClient(),
    'POST',
  )

  // add email claim for client protocolMappers
  createNockReplyObject(
    'protocols.realmClientsIdProtocolMappersModelsPost',
    `${baseAddress}/${keycloakRealm}/clients/${env.KEYCLOAK_CLIENT_ID}/protocol-mappers/models`,
    realmConfig.createClientEmailClaimMapper(),
    'POST',
  )
  return { running: true }
}

describe('Test Async Unit', () => {
  it('should indicate that Promise resolves true', async () => {
    const spec: any = await Promise.resolve(true)
    expect(spec).to.be.true
  })
})

describe('Keycloak Bootstrapping Settings', () => {
  before(async () => {
    return await createMockedData()
  })

  it('Send request to update client scopes', async () => {
    const reply = await clientScope.realmClientScopesPost(keycloakRealm, realmConfig.createClientScopes())
    expect(reply.body).to.contain({ valid: true })
  })

  it('Send request to create team to role mapper', async () => {
    const role = realmConfig.mapTeamsToRoles()[0]
    const reply = await roles.realmRolesPost(keycloakRealm, role)
    expect(reply.body).to.contain({ valid: true })
  })

  it('Send request to update identity provider', async () => {
    const reply = await providers.realmIdentityProviderInstancesPost(
      keycloakRealm,
      await realmConfig.createIdProvider(),
    )
    expect(reply.body).to.contain({ valid: true })
  })

  it('Send request to create identity provider mapper', async () => {
    const idpMapper = realmConfig.createIdpMappers()[0]
    const reply = await providers.realmIdentityProviderInstancesAliasMappersPost(
      keycloakRealm,
      env.IDP_ALIAS,
      idpMapper,
    )
    expect(reply.body).to.contain({ valid: true })
  })

  it('Send request to create realm client', async () => {
    const reply = await clients.realmClientsPost(keycloakRealm, realmConfig.createClient())
    expect(reply.body).to.contain({ valid: true })
  })

  it('Send request to create email claim for client', async () => {
    const client = realmConfig.createClient()
    const reply = await protocols.realmClientsIdProtocolMappersModelsPost(
      env.KEYCLOAK_REALM,
      client.id,
      realmConfig.createClientEmailClaimMapper(),
    )
    expect(reply.body).to.contain({ valid: true })
  })
})
