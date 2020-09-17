/* eslint-disable @typescript-eslint/camelcase */
import { Issuer } from 'openid-client'
import jwtDecode from 'jwt-decode'

import {
  cleanEnv,
  TEAM_USER,
  TEAM_USER_PASSWORD,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
  KEYCLOAK_CLIENT_ID,
  KEYCLOAK_CLIENT_SECRET,
} from '../../validators'

const env = cleanEnv({
  TEAM_USER,
  TEAM_USER_PASSWORD,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
  KEYCLOAK_CLIENT_ID,
  KEYCLOAK_CLIENT_SECRET,
})

async function main() {
  
  try {
    const keycloakAddress = env.KEYCLOAK_ADDRESS
    const keycloakRealm = env.KEYCLOAK_REALM
    const keycloakIssuer = await Issuer.discover(`${keycloakAddress}/realms/${keycloakRealm}/`)
    const openIdConnectClient = new keycloakIssuer.Client({
      client_id: env.KEYCLOAK_CLIENT_ID,
      client_secret: env.KEYCLOAK_CLIENT_SECRET,
    })
    // test login for default client
    const token = await openIdConnectClient.grant({
        // grant_type: 'password',
        grant_type: 'client_credentials',
        username: env.TEAM_USER,
        password: env.TEAM_USER_PASSWORD,
    })
    console.log("AccessToken Aquired")
    const { groups } = jwtDecode(token.access_token)
    if ( groups.includes("offline_access") ) {
        // console.log(jwtDecode(token.access_token))
        console.log("Success")
    } else {
        console.log("Fail")
        process.exit(1)
    }
  } catch (error) {
    console.error(error)
    console.log("Exiting!")
    process.exit(1)
  }

}

main()
