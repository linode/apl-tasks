import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import querystring from 'querystring'
import cookie from 'cookie'

import { UserApi, CreateOAuth2ApplicationOptions } from '@redkubes/gitea-client-node'

import { cleanEnv, GITEA_PASSWORD, GITEA_URL, DRONE_URL } from '../../validators'
import { createSecret, ensure, getApiClient, getSecret } from '../../utils'
import { username, GiteaDroneError } from './common'

const env = cleanEnv({
  GITEA_PASSWORD,
  GITEA_URL,
  DRONE_URL,
})
export interface DroneSecret {
  clientId: string
  clientSecret: string
}

const namespace = 'team-admin'
const secretName = 'drone-source-control'
const csrfCookieName = '_csrf' // _csrf cookie is the MVC (Minimal Viable Cookie) for authorization & grant to work.
const giteaUrl: string = env.GITEA_URL.endsWith('/') ? env.GITEA_URL.slice(0, -1) : env.GITEA_URL
const droneLoginUrl = `${env.DRONE_URL.endsWith('/') ? env.DRONE_URL.slice(0, -1) : env.DRONE_URL}/login`
const user = new UserApi(username, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)
const auth = {
  username,
  password: env.GITEA_PASSWORD,
}
const oauthOpts = { ...new CreateOAuth2ApplicationOptions(), name: 'otomi-drone', redirectUris: [droneLoginUrl] }

export async function getGiteaAuthorizationHeaderCookies(oauthData: DroneSecret): Promise<string[]> {
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
    ...auth,
  }

  console.info('Authorizing OAuth application')

  try {
    const authorizeResponse: AxiosResponse<any> = await axios.get(`${giteaUrl}/login/oauth/authorize`, options)
    return authorizeResponse.headers['set-cookie']
  } catch (e) {
    // TODO: ask Marc if he can determine wether always to throw here or catch
    // "Authorization already granted" and silence that
    throw new GiteaDroneError('Authorization already granted or something went wrong')
  }
}

export function getCsrfToken(authorizeHeaderCookies: string[]): string {
  // Loop over cookies and find the _csrf cookie and retrieve the value
  const cookieWithName = authorizeHeaderCookies.find((c: string) => c.includes(csrfCookieName))

  if (!cookieWithName) {
    throw new GiteaDroneError(`No ${csrfCookieName} cookie was returned`)
  }

  const cookieObj = cookie.parse(cookieWithName)
  const csrfToken: string = cookieObj[csrfCookieName]

  return csrfToken
}

async function authorizeOAuthApp(oauthData: DroneSecret): Promise<void> {
  const authorizeHeaderCookies: string[] = await getGiteaAuthorizationHeaderCookies(oauthData)

  const csrfToken = getCsrfToken(authorizeHeaderCookies)

  console.info('Granting authorization')

  const grantOptions: AxiosRequestConfig = {
    method: 'POST',
    url: `${giteaUrl}/login/oauth/grant`,
    headers: {
      cookie: authorizeHeaderCookies.map((cookie) => cookie.split(';')[0]).join('; '),
    },
    maxRedirects: 1,
    ...auth,
    // Data for this post query must be stringified https://github.com/axios/axios#using-applicationx-www-form-urlencoded-format
    data: querystring.stringify({
      [csrfCookieName]: csrfToken,
      // eslint-disable-next-line @typescript-eslint/camelcase
      client_id: `${oauthData.clientId}`,
      // eslint-disable-next-line @typescript-eslint/camelcase
      redirect_uri: droneLoginUrl,
    }),
  }

  try {
    await axios.request(grantOptions)
  } catch (error) {
    console.debug(error)
    // Do nothing, error code could be on the redirect
  }
}

async function main(): Promise<void> {
  const remoteSecret = (await getSecret(secretName, namespace)) as DroneSecret
  const { body: oauth2Apps } = await user.userGetOauth2Application()
  const oauthApp = oauth2Apps.find(({ name }) => name === oauthOpts.name)

  if (remoteSecret) {
    console.info('Gitea Drone OAuth secret exists')
    await authorizeOAuthApp(remoteSecret)
    return
  }

  // Otherwise, clear (if necessary)
  try {
    await getApiClient().deleteNamespacedSecret(secretName, namespace)
  } catch (e) {
    // Secret didn't exist
  }
  if (oauthApp?.id) {
    await user.userDeleteOAuth2Application(oauthApp.id)
  }

  const { body: oauth2App } = await user.userCreateOAuth2Application(oauthOpts)
  console.info('OAuth app has been created')
  const oauthData = ensure(oauth2App) as DroneSecret

  await authorizeOAuthApp(oauthData)
  console.info('OAuth app has been authorized')

  createSecret(secretName, namespace, oauthData)
}

// Run main only on execution, not on import (like tests)
if (typeof require !== 'undefined' && require.main === module) {
  main()
}
