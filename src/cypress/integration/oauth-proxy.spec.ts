/// <reference types="cypress" />
/* eslint-disable @typescript-eslint/camelcase */
import jwtDecode from 'jwt-decode'

describe('Otomi Landing Page', () => {
    it('should be redirected to keycloak auth page', () => {
        cy.getCookies().should('have.length', 0)
        cy.visit('https://otomi.demo.gke.otomi.cloud/')
        cy.url().should('include', 'https://keycloak.')
    }) 
})
describe('Oauth Proxy Login', () => {
    it('should submit form and redirect to keycloak auth page', () => {
        cy.getCookies().should('have.length', 0)
        cy.visit('https://auth.demo.gke.otomi.cloud/oauth2/sign_in')
        cy.get('form').submit()
        cy.url().should('include', 'https://keycloak.')
    })
    it('should contain azure idp login form', () => {
        cy.get('#zocial-redkubes-azure').should('be.visible')  
    })
})
describe('Azure Login', () => {
    it('should POST auth credentials to azure oauth token endpoint', () => {
        const {idp} = Cypress.config() as Record<string, any> 
        cy.azLogin( (accessToken) => {
            console.log("teamOtomiId",idp.teamOtomiId)
            const jwt = jwtDecode(accessToken)
            console.log( jwt  )
            expect(jwt.groups).to.include(idp.teamOtomiId)
        })
    })
})
describe('KeyCloak Login', () => {
    it('should POST auth credentials to keycloak oidc token endpoint', () => {
        cy.kcLogin( (accessToken) => {
            const jwt = jwtDecode(accessToken)
            console.log( jwt  )
            expect(jwt.groups).to.include("offline_access")
        })
    })
})

