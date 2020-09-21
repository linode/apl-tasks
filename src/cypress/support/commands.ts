/* eslint-disable @typescript-eslint/camelcase */
/// <reference types="cypress" />


// aquire access_token from AZ
Cypress.Commands.add("requestIdpToken", () => {
  const env = Cypress.env()
  cy.request({
    method: "POST",
    url: `${env.IDP_OIDC_URL}/oauth2/token/`,
    form: true,
    body: {
      grant_type: 'password',
      client_id: env.TENANT_CLIENT_ID,
      client_secret: env.TENANT_CLIENT_SECRET,
      resource: env.TENANT_CLIENT_ID,
      username: env.TEAM_USER,
      password: env.TEAM_USER_PASSWORD
    },
  }).then((response) => {
    const accessToken = response.body.access_token
    return  Promise.resolve(accessToken)
  })
})

// aquire access_token from KEYCLOAK
Cypress.Commands.add("requestAccessToken", () => {
  const env = Cypress.env()
  cy.request({
    method: "POST",
    url: `${env.KEYCLOAK_ADDRESS}/realms/master/protocol/openid-connect/token`,
    form: true,
    body: {
      grant_type: 'client_credentials',
      client_id: env.KEYCLOAK_CLIENT_ID,
      client_secret: env.KEYCLOAK_CLIENT_SECRET,
      scope: 'openid',
      username: env.TEAM_USER,
      password: env.TEAM_USER_PASSWORD
    },
  }).then((response) => {
    const accessToken = response.body.access_token
    return  Promise.resolve(accessToken)
  })
})

// Request Userfinfo Endpoint for KEYCLOAK
Cypress.Commands.add("requestUserinfo", (accessToken) => {
  const env = Cypress.env()
  cy.request({
    method: "GET",
    url: `${env.KEYCLOAK_ADDRESS}/realms/master/protocol/openid-connect/userinfo`,
    form: true,
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
  }).then((response) => {
    return  Promise.resolve(response.body)
  })
})

// Request Userfinfo Endpoint for KEYCLOAK
Cypress.Commands.add("validateAccessToken", (accessToken) => {
  const env = Cypress.env()
  const credentials = Buffer.from(`${env.KEYCLOAK_CLIENT_ID}:${env.KEYCLOAK_CLIENT_SECRET}`).toString('base64')
  cy.request({
    method: "POST",
    url: `${env.KEYCLOAK_ADDRESS}/realms/master/protocol/openid-connect/token/introspect`,
    headers: {
      'Content-Type' : 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: {
      token: accessToken
    },
    form: true
  }).then((response) => {
    return  Promise.resolve(response.body)
  })
})

// obtain pub key certificate from KEYCLOAK
Cypress.Commands.add("obtainPubKey", () => {
  const env = Cypress.env()
  cy.request({
    method: "GET",
    url: `${env.KEYCLOAK_ADDRESS}/realms/master/`,
  }).then((response) => {
    const pubKey = response.body.public_key
    return Promise.resolve(pubKey)
  })

})

export {
  // Use an empty export to please Babel's single file emit.
  // https://github.com/Microsoft/TypeScript/issues/15230
}
