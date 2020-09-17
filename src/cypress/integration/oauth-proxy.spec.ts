import jwtDecode from 'jwt-decode'

describe('Otomi Landing Page', () => {
    it('should be redirected to keycloak auth page', () => {
        cy.visit('https://otomi.demo.gke.otomi.cloud/')
        cy.url().should('include', 'https://keycloak.')
    }) 
})
describe('Oauth Proxy Login', () => {
    it('should open otomi auth page', () => {
        cy.visit('https://auth.demo.gke.otomi.cloud/oauth2/sign_in')
        cy.get('form').submit()
        cy.url().should('include', 'https://keycloak.')
        cy.get('#zocial-redkubes-azure').click()
        cy.url()
    })
})
describe('Azure Login', () => {
    it('should POST auth credentials to azure oauth token endpoint', () => {
        const teamOtomiId = Cypress.config("idp")["teamOtomiId"]
        cy.azLogin( (access_token) => {
            console.log("teamOtomiId",teamOtomiId)
            // const access_token = localStorage.getItem("idp_access_token");
            const jwt = jwtDecode(access_token)
            console.log( jwt  )
            expect(jwt.groups).to.include(teamOtomiId)
        })
    })
})
describe('KeyCloak Login', () => {
    it('should POST auth credentials to keycloak oidc token endpoint', () => {
        cy.kcLogin( (access_token) => {
            // const access_token = localStorage.getItem("kc_access_token");
            const jwt = jwtDecode(access_token)
            console.log( jwt  )
            expect(jwt.groups).to.include("offline_access")
        })
    })
})
