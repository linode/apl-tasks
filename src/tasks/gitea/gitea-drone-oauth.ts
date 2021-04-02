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
export interface DroneSecret {
  clientId: string
  clientSecret: string
}

export class GiteaDroneError extends Error {
  constructor(m?: string) {
    super(m)
    Object.setPrototypeOf(this, GiteaDroneError.prototype)
  }
}

const k8sNamespace = 'gitea'
const k8sSecretName = 'gitea-drone-secret'
const csrfCookieName = '_csrf' // _csrf cookie is the MVC (Minimal Viable Cookie) for authorization & grant to work.

async function getSecret(apiClient: k8s.CoreV1Api): Promise<DroneSecret> {
  try {
    const response = await apiClient.readNamespacedSecret(k8sSecretName, k8sNamespace)
    const {
      body: { data },
    } = response
    return {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
    } as DroneSecret
  } catch (e) {
    return undefined
  }
}
export async function getGiteaAuthorizationHeaderCookies(
  giteaUrl: string,
  droneLoginUrl: string,
  oauthData: DroneSecret,
): Promise<string[]> {
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

  const authorizeResponse: AxiosResponse<any> = await axios.get(`${giteaUrl}/login/oauth/authorize`, options)

  return authorizeResponse.headers['set-cookie']
}

export function getCookieValue(authorizeHeaderCookies: string[], cookieName: string): string {
  // Loop over cookies and find the _csrf cookie and retrieve the value
  const hasCookieName = (cookie: string) => cookie.includes(cookieName)
  const cookiesWithName: string[] = authorizeHeaderCookies.filter(hasCookieName) // Find cookie that contains _csrf

  if (cookiesWithName.length == 0) {
    throw new GiteaDroneError(`No ${cookieName} cookie was returned`)
  }

  const cookieValues: string[] = cookiesWithName[0]
    .split(';') // Split that cookie into multiple parts, as a single cookie can contain multiple key/values ';' separated
    .map((c) => c.trim())
    .filter(hasCookieName) // Find the key/value pair with _csrf as key
    .map((cookie) => cookie.substring(cookieName.length + 1)) // Retrieve value for '_csrf'-key

  if (cookieValues.length == 0 || cookieValues[0] === '') {
    throw new GiteaDroneError(`No value for ${cookieName} was found`)
  }
  return cookieValues[0]
}

async function authorizeOAuthApp(giteaUrl: string, droneLoginUrl: string, oauthData: DroneSecret) {
  let authorizeHeaderCookies: string[]
  try {
    authorizeHeaderCookies = await getGiteaAuthorizationHeaderCookies(giteaUrl, droneLoginUrl, oauthData)
  } catch (error) {
    throw new GiteaDroneError('Authorization already granted or something went wrong')
  }

  const csrfToken = getCookieValue(authorizeHeaderCookies, csrfCookieName)

  console.log('Granting authorization')

  const grantOptions: AxiosRequestConfig = {
    method: 'POST',
    url: `${giteaUrl}/login/oauth/grant`,
    headers: {
      cookie: authorizeHeaderCookies.map((cookie) => cookie.split(';')[0]).join('; '),
      Cookie: authorizeHeaderCookies.map((cookie) => cookie.split(';')[0]).join('; '),
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

export function isSecretValid(remoteSecret: DroneSecret, oauthApps: OAuth2Application[]): boolean {
  if (!remoteSecret) {
    console.log('Remote secret was not found')
  } else if (remoteSecret.clientId === '' || remoteSecret.clientSecret === '') {
    console.log('Remote secret values were empty')
  } else if (oauthApps.length == 0) {
    console.log("Gitea doesn't have any oauth application defined")
  } else if (!oauthApps.some((e) => e.clientId === Buffer.from(remoteSecret.clientId, 'base64').toString())) {
    console.log('OAuth data did not match with expected secret')
  } else {
    return true
  }
  return false
}
async function createK8SSecret(apiClient: k8s.CoreV1Api, result: DroneSecret) {
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
async function main() {
  const giteaUrl: string = env.GITEA_URL.endsWith('/') ? env.GITEA_URL.slice(0, 1) : env.GITEA_URL
  const droneLoginUrl: string = giteaUrl.replace('gitea', 'drone') + '/login'

  const kc = new k8s.KubeConfig()
  kc.loadFromDefault()
  const apiClient = kc.makeApiClient(k8s.CoreV1Api)

  const user = new UserApi(env.GITEA_USER, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)
  const oauthOpts = new CreateOAuth2ApplicationOptions()
  oauthOpts.name = 'otomi-drone'
  oauthOpts.redirectUris = [droneLoginUrl]
  const remoteSecret: DroneSecret = await getSecret(apiClient)
  const oauthAppsResponse = await user.userGetOauth2Application()
  const oauthApps: OAuth2Application[] = oauthAppsResponse.body.filter((x) => x.name === oauthOpts.name)

  // If secret exists (correctly) and oauth apps are (still) defined, everything is good
  if (isSecretValid(remoteSecret, oauthApps)) {
    console.log('Gitea Drone OAuth secret exists')
    const oauthData: DroneSecret = {
      clientId: Buffer.from(remoteSecret.clientId, 'base64').toString(),
      clientSecret: Buffer.from(remoteSecret.clientSecret, 'base64').toString(),
    }
    await authorizeOAuthApp(giteaUrl, droneLoginUrl, oauthData)
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

  const createOauthAppsResponse = await user.userCreateOAuth2Application(oauthOpts)
  const result: OAuth2Application = createOauthAppsResponse.body
  console.log('OAuth app has been created')
  const oauthData: DroneSecret = {
    clientId: result.clientId,
    clientSecret: result.clientSecret,
  }

  await authorizeOAuthApp(giteaUrl, droneLoginUrl, oauthData)
  console.log('OAuth app has been authorized')

  createK8SSecret(apiClient, oauthData)
}

// Run main only on execution, not on import (like tests)
if (typeof require !== 'undefined' && require.main === module) {
  try {
    main()
  } catch (err) {
    if (err instanceof GiteaDroneError) {
      console.log(err)
    } else throw err
  }
}
