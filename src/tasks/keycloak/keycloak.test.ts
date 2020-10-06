/* eslint-disable @typescript-eslint/camelcase */
import { expect } from 'chai'
import { matches, map, pick, sortBy } from 'lodash'
import sinon from 'sinon'
import {
  ClientsApi,
  IdentityProvidersApi,
  ClientScopesApi,
  RolesApi,
  ProtocolMappersApi,
} from '@redkubes/keycloak-client-node'
import * as realmConfig from './realm-factory'
import * as settings from './config'
import { OidcProviderCfg } from './config'
import {
  cleanEnv,
  IDP_ALIAS,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
  KEYCLOAK_CLIENT_ID,
  IDP_OIDC_URL,
} from '../../validators'

const env = cleanEnv({
  IDP_ALIAS,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
  KEYCLOAK_CLIENT_ID,
  IDP_OIDC_URL,
})
import nock from 'nock'

// Configuration Variables
const keycloakAddress = env.KEYCLOAK_ADDRESS
const keycloakRealm = env.KEYCLOAK_REALM
const oidcUrl = env.IDP_OIDC_URL
const basePath = `${keycloakAddress}/admin/realms`
const host = process.env.NODE_ENV === 'test' ? 'http://127.0.0.1:8080' : keycloakAddress
const baseAddress = process.env.NODE_ENV === 'test' ? '/dev/admin/realms' : '/admin/realms'
const mockedId = '000-000'
const mockedSecret = 'somesecret'
const isValid = { valid: true }
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

// utility function to mock server responses
// const nockReplies = {}
function registerNockResponse(methodName, url, payload, requestType) {
  // nockReplies[methodName] = { url: url, payload: payload, requestType: requestType }
  switch (requestType) {
    case 'POST':
      nock(host).persist().post(url, matches(payload)).reply(200, isValid)
      break
    case 'PUT':
      nock(host).persist().put(url, matches(payload)).reply(200, isValid)
      break
  }
}
// creating mocked data payloads for Keycloak openapi client requests
async function createMockedData() {
  // faked response for .well-known endpoints
  const fakeIdpConfig = {
    token_endpoint: `${oidcUrl}/oauth2/v2.0/token`,
    jwks_uri: `${oidcUrl}/discovery/v2.0/keys`,
    issuer: `${oidcUrl}/v2.0`,
    userinfo_endpoint: `${oidcUrl}/oidc/userinfo`,
    authorization_endpoint: `${oidcUrl}/oauth2/v2.0/authorize`,
    end_session_endpoint: `${oidcUrl}/oauth2/v2.0/logout`,
  }

  // stub function to resolve fake endpoints
  const fakeDiscoveryUrlsStub = sinon.fake.resolves(fakeIdpConfig)
  sinon.replace(settings, 'getDiscoveryUrls', fakeDiscoveryUrlsStub)

  // faked idp representation object
  const fakeOidcConfig = await settings.getDiscoveryUrls(oidcUrl)
  const idpRepresentation = {
    alias: mockedId,
    displayName: mockedId,
    providerId: 'oidc',
    enabled: true,
    trustEmail: true,
    firstBrokerLoginFlowAlias: 'first broker login',
    config: settings.oidcCfg(fakeOidcConfig as OidcProviderCfg, mockedId, mockedId, mockedSecret),
  }

  // stub function to resolve fake idp config
  const fakeIdpStub = sinon.fake.resolves(idpRepresentation)
  sinon.replace(realmConfig, 'createIdProvider', fakeIdpStub)

  //  Client Scopes
  registerNockResponse(
    'clientScope.realmClientScopesPost',
    `${baseAddress}/${keycloakRealm}/client-scopes`,
    pick(realmConfig.createClientScopes(), ['name', 'protocol', 'attributes']),
    'POST',
  )

  registerNockResponse(
    'clientScope.realmClientScopesIdPut',
    `${baseAddress}/${keycloakRealm}/client-scopes/${mockedId}`,
    pick(realmConfig.createClientScopes(), ['name', 'protocol', 'attributes']),
    'PUT',
  )

  //  Roles
  registerNockResponse(
    'roles.realmRolesPost',
    `${baseAddress}/${keycloakRealm}/roles`,
    sortBy(
      map(realmConfig.mapTeamsToRoles() as Array<object>, (element) => {
        return pick(element, ['name', 'description'])
      }),
      'name',
    )[0],
    'POST',
  )

  registerNockResponse(
    'roles.realmRolesRoleNamePut',
    `${baseAddress}/${keycloakRealm}/roles/${mockedId}`,
    sortBy(
      map(realmConfig.mapTeamsToRoles() as Array<object>, (element) => {
        return pick(element, ['name', 'description'])
      }),
      'name',
    )[0],
    'PUT',
  )

  //  Identity Provider
  registerNockResponse(
    'providers.realmIdentityProviderInstancesPost',
    `${baseAddress}/${keycloakRealm}/identity-provider/instances`,
    await realmConfig.createIdProvider(),
    'POST',
  )

  registerNockResponse(
    'providers.realmIdentityProviderInstancesAliasPut',
    `${baseAddress}/${keycloakRealm}/identity-provider/instances/${mockedId}`,
    await realmConfig.createIdProvider(),
    'PUT',
  )

  //  Identity Provider Mappers
  registerNockResponse(
    'providers.realmIdentityProviderInstancesAliasMappersPost',
    `${baseAddress}/${keycloakRealm}/identity-provider/instances/${env.IDP_ALIAS}/mappers`,
    sortBy(
      map(realmConfig.createIdpMappers() as Array<object>, (element) => {
        return pick(element, ['name', 'identityProviderAlias'])
      }),
      'name',
    )[0],
    'POST',
  )

  //  Client
  registerNockResponse(
    'clients.realmClientsPost',
    `${baseAddress}/${keycloakRealm}/clients`,
    pick(realmConfig.createClient(), ['id', 'secret']),
    'POST',
  )

  registerNockResponse(
    'clients.realmClientsIdPut',
    `${baseAddress}/${keycloakRealm}/clients/${mockedId}`,
    pick(realmConfig.createClient(), ['id', 'secret']),
    'PUT',
  )

  //  Email claim for client protocolMappers
  registerNockResponse(
    'protocols.realmClientsIdProtocolMappersModelsPost',
    `${baseAddress}/${keycloakRealm}/clients/${env.KEYCLOAK_CLIENT_ID}/protocol-mappers/models`,
    pick(realmConfig.createClientEmailClaimMapper(), ['name', 'protocol', 'config']),
    'POST',
  )
}

describe('Keycloak Bootstrapping Settings', () => {
  before(async () => {
    await createMockedData()
  })

  //  Client Scopes Methods
  it('Should validate POST request to create client scopes', async () => {
    const reply = await clientScope.realmClientScopesPost(keycloakRealm, realmConfig.createClientScopes())
    expect(reply.body).to.contain(isValid)
  })

  it('Should validate PUT request to update client scopes', async () => {
    const reply = await clientScope.realmClientScopesIdPut(keycloakRealm, mockedId, realmConfig.createClientScopes())
    expect(reply.body).to.contain(isValid)
  })

  //  Roles Methods
  it('Should validate POST request to create team to role mapper', async () => {
    const role = sortBy(realmConfig.mapTeamsToRoles(), 'name')[0]
    const reply = await roles.realmRolesPost(keycloakRealm, role)
    expect(reply.body).to.contain(isValid)
  })

  it('Should validate PUT request to update team to role mapper', async () => {
    const role = sortBy(realmConfig.mapTeamsToRoles(), 'name')[0]
    const reply = await roles.realmRolesRoleNamePut(keycloakRealm, mockedId, role)
    expect(reply.body).to.contain(isValid)
  })

  //  Identity Provider Methods
  it('Should validate POST request to create identity provider', async () => {
    const reply = await providers.realmIdentityProviderInstancesPost(
      keycloakRealm,
      await realmConfig.createIdProvider(),
    )
    expect(reply.body).to.contain(isValid)
  })

  it('Should validate PUT request to update identity provider', async () => {
    const reply = await providers.realmIdentityProviderInstancesAliasPut(
      keycloakRealm,
      mockedId,
      await realmConfig.createIdProvider(),
    )
    expect(reply.body).to.contain(isValid)
  })

  //  Identity Provider Mappers Methods
  it('Should validate POST request to create identity provider mapper', async () => {
    const idpMapper = sortBy(realmConfig.createIdpMappers(), 'name')[0]
    const reply = await providers.realmIdentityProviderInstancesAliasMappersPost(
      keycloakRealm,
      env.IDP_ALIAS,
      idpMapper,
    )
    expect(reply.body).to.contain(isValid)
  })

  //   Client Methods
  it('Should validate POST request to create realm client', async () => {
    const reply = await clients.realmClientsPost(keycloakRealm, realmConfig.createClient())
    expect(reply.body).to.contain(isValid)
  })

  it('Should validate POST request to update realm client', async () => {
    const reply = await clients.realmClientsIdPut(keycloakRealm, mockedId, realmConfig.createClient())
    expect(reply.body).to.contain(isValid)
  })

  //  Email claim for client protocolMappers
  it('Should validate POST request to create email claim for client', async () => {
    const client = realmConfig.createClient()
    const reply = await protocols.realmClientsIdProtocolMappersModelsPost(
      keycloakRealm,
      client.id,
      realmConfig.createClientEmailClaimMapper(),
    )
    expect(reply.body).to.contain(isValid)
  })
})
