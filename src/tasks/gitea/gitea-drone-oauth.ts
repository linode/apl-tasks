import * as k8s from '@kubernetes/client-node'
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import querystring from 'querystring'

import { UserApi, CreateOAuth2ApplicationOptions, OAuth2Application } from '@redkubes/gitea-client-node'

import { cleanEnv, GITEA_USER, GITEA_PASSWORD, GITEA_URL, GITEA_REPO } from '../../validators'

const env = cleanEnv({
  GITEA_USER,
  GITEA_PASSWORD,
  GITEA_URL,
  GITEA_REPO,
})
type DroneSecret = {
  clientId: string
  clientSecret: string
}

let apiClient: k8s.CoreV1Api
const k8sNamespace = 'gitea'
const k8sSecretName = 'gitea-drone-secret'
// _csrf cookie is the MVC (Minimal Viable Cookie) for authorization & grant to work.
const csrfCookieName = '_csrf'

let oauthData: DroneSecret

let giteaUrl: string
let droneUrl: string
let droneLoginUrl: string

function setup() {
  giteaUrl = env.GITEA_URL
  if (giteaUrl.endsWith('/')) {
    giteaUrl = giteaUrl.slice(0, -1)
  }
  droneUrl = giteaUrl.replace('gitea', 'drone')
  droneLoginUrl = `${droneUrl}/login`

  const kc = new k8s.KubeConfig()
  kc.loadFromDefault()
  apiClient = kc.makeApiClient(k8s.CoreV1Api)
}

async function secretExists(): Promise<DroneSecret> {
  try {
    const response = (await apiClient.readNamespacedSecret(k8sSecretName, k8sNamespace)).body
    return response.data as DroneSecret
  } catch (e) {
    return undefined
  }
}
async function authorizeOAuthApp() {
  const options: AxiosRequestConfig = {
    params: {
      // eslint-disable-next-line @typescript-eslint/camelcase
      client_id: oauthData.clientId,
      // eslint-disable-next-line @typescript-eslint/camelcase
      redirect_uri: droneLoginUrl,
      // eslint-disable-next-line @typescript-eslint/camelcase
      response_type: 'code',
    },
    maxRedirects: 1,
    auth: {
      username: env.GITEA_USER,
      password: env.GITEA_PASSWORD,
    },
  }

  console.log('Authorizing OAuth application')

  let authorizeResponse: AxiosResponse<any>
  try {
    authorizeResponse = await axios.get(`${giteaUrl}/login/oauth/authorize`, options)
  } catch (error) {
    console.log('Authorization already granted or something went wrong')
    return
  }

  const authorizeHeaderCookies: string[] = authorizeResponse.headers['set-cookie']

  // Loop over cookies and find the _csrf cookie and retrieve the value
  const csrfCookies = authorizeHeaderCookies.filter((cookie) => {
    return cookie.includes(csrfCookieName) // Find cookie that contains _csrf
  })

  if (csrfCookies.length == 0) {
    console.log('No CSRF cookie was returned')
    return
  }

  const csrfTokens = csrfCookies[0]
    .split(';') // Split that cookie into multiple parts, as a single cookie can contain multiple key/values ';' separated
    .map((c) => c.trim())
    .filter((cookie) => {
      return cookie.includes(csrfCookieName) // Find the key/value pair with _csrf as key
    })
    .map((cookie) => {
      return cookie.substring(csrfCookieName.length + 1) // Retrieve value for '_csrf'-key
    })

  if (csrfTokens.length == 0) {
    console.log('No CSRF token was returned')
    return
  }
  const csrfToken = csrfTokens[0]

  console.log('Granting authorization')

  const grantOptions: AxiosRequestConfig = {
    method: 'POST',
    url: `${giteaUrl}/login/oauth/grant`,
    headers: {
      cookie: authorizeHeaderCookies
        .map((cookie) => {
          return cookie.split(';')[0]
        })
        .join('; '),
      Cookie: authorizeHeaderCookies
        .map((cookie) => {
          return cookie.split(';')[0]
        })
        .join('; '),
    },
    maxRedirects: 1,
    auth: {
      username: env.GITEA_USER,
      password: env.GITEA_PASSWORD,
    },
    // Data for this post query must be stringified https://github.com/axios/axios#using-applicationx-www-form-urlencoded-format
    data: querystring.stringify({
      _csrf: csrfToken,
      // eslint-disable-next-line @typescript-eslint/camelcase
      client_id: `${oauthData.clientId}`,
      // eslint-disable-next-line @typescript-eslint/camelcase
      redirect_uri: droneLoginUrl,
    }),
  }

  try {
    await axios.request(grantOptions)
  } catch (error) {
    // Do nothing, error code could be on the redirect
  }
}

async function main() {
  const user = new UserApi(env.GITEA_USER, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)
  const oauthOpts = new CreateOAuth2ApplicationOptions()
  oauthOpts.name = 'otomi-drone'
  oauthOpts.redirectUris = [droneLoginUrl]
  const remoteSecret = await secretExists()
  const oauthApps: OAuth2Application[] = (await user.userGetOauth2Application()).body.filter(
    (x) => x.name === oauthOpts.name,
  )
  // If secret exists (correctly) and oauth apps are (still) defined, everything is good
  if (!remoteSecret) {
    console.log('Remote secret was not found')
  } else if (remoteSecret.clientId.length == 0 || remoteSecret.clientSecret.length == 0) {
    console.log('Remote secret values were empty')
  } else if (oauthApps.length == 0) {
    console.log("Gitea doesn't have any oauth application defined")
  } else if (!oauthApps.some((e) => e.clientId === Buffer.from(remoteSecret.clientId, 'base64').toString())) {
    console.log('OAuth data did not match with expected secret')
  } else {
    console.log('Gitea Drone OAuth secret exists')
    oauthData = {
      clientId: Buffer.from(remoteSecret.clientId, 'base64').toString(),
      clientSecret: Buffer.from(remoteSecret.clientSecret, 'base64').toString(),
    }
    await authorizeOAuthApp()
    return
  }

  // Otherwise, clear (if necessary)
  try {
    await apiClient.deleteNamespacedSecret(k8sSecretName, k8sNamespace)
  } catch (e) {
    // Secret didn't exist in
  }
  if (oauthApps.length > 0) {
    for (const oauthApp of oauthApps) {
      user.userDeleteOAuth2Application(oauthApp.id)
    }
  }

  const result: OAuth2Application = (await user.userCreateOAuth2Application(oauthOpts)).body
  console.log('OAuth app has been created')
  oauthData = {
    clientId: result.clientId,
    clientSecret: result.clientSecret,
  }

  await authorizeOAuthApp()
  console.log('OAuth app has been authorized')

  const secret: k8s.V1Secret = new k8s.V1Secret()
  secret.metadata = new k8s.V1ObjectMeta()
  secret.metadata.name = k8sSecretName
  secret.metadata.namespace = k8sNamespace
  secret.data = {
    clientId: Buffer.from(result.clientId).toString('base64'),
    clientSecret: Buffer.from(result.clientSecret).toString('base64'),
  }

  await apiClient.createNamespacedSecret(k8sNamespace, secret)
  console.log(`New secret ${k8sSecretName} has been created in the namespace ${k8sNamespace}`)
}

setup()
main()
