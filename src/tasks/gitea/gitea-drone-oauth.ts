import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import querystring from 'querystring'
import cookie from 'cookie'

import { UserApi, CreateOAuth2ApplicationOptions } from '@redkubes/gitea-client-node'

import { cleanEnv, GITEA_PASSWORD, GITEA_URL, DRONE_URL } from '../../validators'
import { createSecret, doApiCall, getApiClient, getSecret } from '../../utils'
import { orgName, username, GiteaDroneError } from './common'

const env = cleanEnv({
  GITEA_PASSWORD,
  GITEA_URL,
  DRONE_URL,
})
export interface DroneSecret {
  clientId: string
  clientSecret: string
}

const errors: string[] = []
const namespace = 'team-admin'
const secretName = 'drone-source-control'
const csrfCookieName = '_csrf' // _csrf cookie is the MVC (Minimal Viable Cookie) for authorization & grant to work.
const giteaUrl: string = env.GITEA_URL.endsWith('/') ? env.GITEA_URL.slice(0, -1) : env.GITEA_URL
const droneLoginUrl = `${env.DRONE_URL.endsWith('/') ? env.DRONE_URL.slice(0, -1) : env.DRONE_URL}/login`
const userApi = new UserApi(username, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)
const auth = {
  username: orgName,
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
    auth,
  }

  console.info('Authorizing OAuth application')

  try {
    const authorizeResponse: AxiosResponse<any> = await axios.get(`${giteaUrl}/login/oauth/authorize`, options)
    return authorizeResponse.headers['set-cookie']
  } catch (e) {
    // since we can't determine wether there was a real error or not, we throw a GiteaDroneError
    // which we can later catch and deem not fatal
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
  // from the csrf cookie we only need to forward the csrf key value
  // the next line takes cars of that:
  const forwardCookies = authorizeHeaderCookies.map((c) => c.split(';')[0]).join('; ')

  const grantOptions: AxiosRequestConfig = {
    method: 'POST',
    url: `${giteaUrl}/login/oauth/grant`,
    headers: {
      cookie: forwardCookies,
    },
    maxRedirects: 1,
    auth,
    // Data for this post query must be stringified https://github.com/axios/axios#using-applicationx-www-form-urlencoded-format
    data: querystring.stringify({
      [csrfCookieName]: csrfToken,
      // eslint-disable-next-line @typescript-eslint/camelcase
      client_id: `${oauthData.clientId}`,
      // eslint-disable-next-line @typescript-eslint/camelcase
      redirect_uri: droneLoginUrl,
    }),
  }

  await doApiCall(errors, 'Granting authorization', () => axios.request(grantOptions))
}

async function main(): Promise<void> {
  // fresh cluster: no secret no oauth app
  // already exists: cluster with predeployed secret and oauth app
  const remoteSecret = (await getSecret(secretName, namespace)) as DroneSecret
  const oauth2Apps = await doApiCall(errors, 'Getting oauth2 app', () => userApi.userGetOauth2Application())
  const oauthApp = oauth2Apps.find(({ name }) => name === oauthOpts.name)

  // when we encounter both secret and oauth app we can conclude that the previous run
  // which created the oauth app ended successfully
  if (remoteSecret && oauthApp) {
    console.info('Gitea Drone OAuth secret exists')
    await authorizeOAuthApp(remoteSecret)
    return
  }

  // Otherwise, clear (if necessary)
  await doApiCall(errors, 'Deleting old secret', () => getApiClient().deleteNamespacedSecret(secretName, namespace))
  if (oauthApp?.id) {
    await doApiCall(errors, 'Deleting old oauth2 app', () => userApi.userDeleteOAuth2Application(oauthApp.id))
  }

  // an create again
  const oauth2App = await doApiCall(errors, 'Creating oauth2 app', () => userApi.userCreateOAuth2Application(oauthOpts))
  await authorizeOAuthApp(oauth2App)

  createSecret(secretName, namespace, oauth2App)
}

// Run main only on execution, not on import (like tests)
if (typeof require !== 'undefined' && require.main === module) {
  main()
}
