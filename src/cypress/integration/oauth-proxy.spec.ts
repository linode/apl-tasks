/* eslint-disable @typescript-eslint/camelcase */
/// <reference types="cypress" />
import jwtDecode from 'jwt-decode'

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
        cy.azLogin( (accessToken) => {
            const jwt = jwtDecode(accessToken)
            expect(jwt.groups).to.include(env.IDP_GROUP_TEAM_OTOMI)
            cy.setCookie('Authorization', `Bearer ${accessToken}`)
        })
    })
})

// @WIP this does not return a valid access_token
describe('Otomi SSO Login', () => {
    it('should Authorize keycloak oidc', () => {
        cy.kcAuthorize( (accessToken) => {
            console.log("Auth_CODE", accessToken)
            // const jwt = jwtDecode(accessToken)
            // console.log(jwt)
            // expect(jwt.groups).to.include("offline_access")
            // cy.wrap(accessToken).as('accessToken');
        })
    })
    it('should obtain valid jwt from keycloak oidc and redirect to otomi landing page', () => {
        cy.kcLogin( (accessToken) => {
            // cy.setCookie('Authorization', `Bearer ${accessToken}`)
            const jwt = jwtDecode(accessToken)
            // console.log(jwt)
            expect(jwt.groups).to.include("offline_access")
            cy.getCookies().should('have.length', 0)
            cy.wrap(accessToken).as('accessToken');
        })
        
        cy.get("@accessToken").then( (accessToken) => {
            const otomiDomain = 'otomi.demo.gke.otomi.cloud'
            cy.setCookie('Authorization', `Bearer ${accessToken}`)
            cy.visit(`https://auth.demo.gke.otomi.cloud/oauth2/redirect/${otomiDomain}`)
        })
    })
})

