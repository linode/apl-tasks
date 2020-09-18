/// <reference types="cypress" />
declare namespace Cypress {
    interface Chainable {
        /**
         * Custom commands to login via oauth
         */
        azLogin(fn: (string) => void ): void
        kcLogin(fn: (string) => void ): void
        kcAuthorize(fn: (string) => void ): void
    }
  }
  
