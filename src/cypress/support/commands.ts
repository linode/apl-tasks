/* eslint-disable @typescript-eslint/camelcase */
/// <reference types="cypress" />

import { uniqueId } from "lodash";

// aquire access_token from AZ
Cypress.Commands.add("azLogin", (fn) => {
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
    const access_token = response.body.access_token;
    fn(access_token)
  });
});

// aquire authorization code from KEYCLOAK
Cypress.Commands.add("kcAuthorize", (fn) => {
  const env = Cypress.env()
  const otomiDomain = 'https://otomi.demo.gke.otomi.cloud/'
  cy.request({
    method: "POST",
    url: `${env.KEYCLOAK_ADDRESS}/realms/master/protocol/openid-connect/auth`,
    form: true,
    qs: {
      rd: otomiDomain
    },
    body: {
      grant_type: 'authorization_code',
      response_type: 'id_token token code',
      response_mode: 'fragment',
      redirect_uri: `https://auth.demo.gke.otomi.cloud/oauth2/callback`,
      nonce: uniqueId(),
      client_id: env.KEYCLOAK_CLIENT_ID,
      client_secret: env.KEYCLOAK_CLIENT_SECRET,
      scope: 'openid',
      username: env.TEAM_USER,
      password: env.TEAM_USER_PASSWORD
    },
  }).then((response) => {
      const access_token = response.body.access_token;
    fn(access_token)
  });
});

// aquire access_token from KEYCLOAK
Cypress.Commands.add("kcLogin", (fn) => {
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
      const access_token = response.body.access_token;
      fn(access_token)
  });
});

  export {
    // Use an empty export to please Babel's single file emit.
    // https://github.com/Microsoft/TypeScript/issues/15230
  }
