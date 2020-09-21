/* eslint-disable @typescript-eslint/camelcase */
/// <reference types="cypress" />
import * as jwt from 'jsonwebtoken'

describe('Otomi Landing Page', () => {
    it('should visit landing page and be redirected to keycloak auth page', () => {
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
        cy.get('#zocial-redkubes-azure').click()  
    })
})
describe('Azure Login', () => {
    it('should POST auth credentials to azure oauth token endpoint and obtain valid JWT', () => {
        const env = Cypress.env() 
        cy.requestIdpToken().then( (accessToken) => {
            const jwtToken = jwt.decode(accessToken)
            expect(jwtToken['groups']).to.include(env.IDP_GROUP_TEAM_OTOMI)
            cy.setCookie('Authorization', `Bearer ${accessToken}`)
        })
    })
})
describe('Otomi SSO Authentication Flows', () => {
    let accessToken
    before(() => {
        cy.requestAccessToken().then( (token) => { 
            accessToken = token
            expect(accessToken).to.be.not.empty
        })
    })
    it('should obtain and decode jwt and verify groups exist', () => {
        const jwtToken = jwt.decode(accessToken)
        expect(jwtToken['groups']).to.include("offline_access")
        cy.getCookies().should('have.length', 0)
    })
    it('should obtain user information using access token', () => {
        cy.requestUserinfo(accessToken).then( (response) => {
            expect(response['groups']).to.include("offline_access")
        })
    })
    it('should validate access token from introspect endpoint', () => {
        cy.validateAccessToken(accessToken).then( (response) => {
            expect(response['groups']).to.include("offline_access")
        })
    })
})
