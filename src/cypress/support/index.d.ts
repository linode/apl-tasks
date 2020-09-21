/// <reference types="cypress" />

declare namespace Cypress {
    interface Chainable {
        /**
         * Custom commands related to oauth flows
         */
        requestIdpToken(): Promise<string>
        requestAccessToken(): Promise<string>
        obtainPubKey(): Promise<string>
        requestUserinfo(token: string): Promise<object>
        validateAccessToken(token: string): Promise<object>
    }
  }
  
