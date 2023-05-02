import { CreateOAuth2ApplicationOptions, OAuth2Application, UserApi } from '@redkubes/gitea-client-node'
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import cookie from 'cookie'
import { URLSearchParams } from 'url'
import { createSecret, getSecret, k8s } from '../../k8s'
import { doApiCall } from '../../utils'
import { cleanEnv, DRONE_NAMESPACE, DRONE_URL, GITEA_PASSWORD, GITEA_URL, OTOMI_VALUES } from '../../validators'
import { username } from '../common'
import { GiteaDroneError } from './common'

const env = cleanEnv({
  GITEA_PASSWORD,
  GITEA_URL,
  DRONE_NAMESPACE,
  DRONE_URL,
  OTOMI_VALUES,
})
export interface DroneSecret {
  clientId: string
  clientSecret: string
}

const errors: string[] = []
const namespace = env.DRONE_NAMESPACE
const secretName = 'drone-source-control'
const csrfCookieName = '_csrf' // _csrf cookie is the MVC (Minimal Viable Cookie) for authorization & grant to work.
const giteaUrl: string = env.GITEA_URL.endsWith('/') ? env.GITEA_URL.slice(0, -1) : env.GITEA_URL
const droneLoginUrl = `${env.DRONE_URL.endsWith('/') ? env.DRONE_URL.slice(0, -1) : env.DRONE_URL}/login`
const userApi = new UserApi(username, env.GITEA_PASSWORD, `${giteaUrl}/api/v1`)
const auth = {
  username,
  password: env.GITEA_PASSWORD,
}
const oauthOpts = { ...new CreateOAuth2ApplicationOptions(), name: 'otomi-drone', redirectUris: [droneLoginUrl] }

export async function getGiteaAuthorizationHeaderCookies(oauthData: DroneSecret): Promise<string[]> {
  const options: AxiosRequestConfig = {
    params: {
      client_id: oauthData.clientId,
      redirect_uri: droneLoginUrl,
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
    throw new GiteaDroneError('Authorization already granted!')
  }
}

export function getCsrfToken(authorizeHeaderCookies: string[]): string {
  // Loop over cookies and find the _csrf cookie and retrieve the value
  const cookieWithName = authorizeHeaderCookies.find((c: string) => c.includes(csrfCookieName))

  const cookieObj = cookie.parse(cookieWithName)
  const csrfToken: string = cookieObj[csrfCookieName]

  return csrfToken
}

async function authorizeOAuthApp(oauthData: DroneSecret): Promise<void> {
  const authorizeHeaderCookies: string[] = await getGiteaAuthorizationHeaderCookies(oauthData)

  const csrfToken = getCsrfToken(authorizeHeaderCookies)

  const grantOptions: AxiosRequestConfig = {
    method: 'POST',
    url: `${giteaUrl}/login/oauth/grant`,
    headers: {
      cookie: authorizeHeaderCookies.join('; '),
    },
    maxRedirects: 1,
    auth,
    // Data for this post query must be stringified https://github.com/axios/axios#using-applicationx-www-form-urlencoded-format
    data: new URLSearchParams({
      [csrfCookieName]: csrfToken,
      client_id: `${oauthData.clientId}`,
      redirect_uri: droneLoginUrl,
      confidential_client: true,
    }),
  }

  await doApiCall(errors, 'Granting authorization', () => axios.request(grantOptions))
}

async function main(): Promise<void> {
  // await waitTillAvailable(env.GITEA_URL) // previous task waited already, and this is second

  // fresh cluster: no secret no oauth app
  // already exists: cluster with predeployed secret and oauth app
  const remoteSecret = (await getSecret(secretName, namespace)) as DroneSecret
  const oauth2Apps = await doApiCall(errors, 'Getting oauth2 app', () => userApi.userGetOauth2Application())
  const previousOauth2App = (oauth2Apps || []).find(({ name }) => name === oauthOpts.name) as OAuth2Application

  // when we encounter both secret and oauth app we can conclude that the previous run
  // which created the oauth app ended successfully, so we keep them unless domain changed
  if (
    remoteSecret &&
    previousOauth2App &&
    previousOauth2App.redirectUris?.find((r) => r.includes(env.OTOMI_VALUES.cluster.domainSuffix))
  ) {
    console.info('Gitea Drone OAuth2 app and secret exist')
    await authorizeOAuthApp(remoteSecret)
    return
  }

  // Otherwise, clear old stuff (if necessary)
  if (remoteSecret)
    await doApiCall(errors, 'Deleting old secret', () => k8s.core().deleteNamespacedSecret(secretName, namespace))
  if (previousOauth2App?.id)
    await doApiCall(errors, 'Deleting old oauth2 app', () => userApi.userDeleteOAuth2Application(previousOauth2App.id!))

  // and (re-)create
  const oauth2App = await doApiCall(errors, 'Creating oauth2 app', () => userApi.userCreateOAuth2Application(oauthOpts))
  const secret = oauth2App as DroneSecret
  await authorizeOAuthApp(oauth2App)

  createSecret(secretName, namespace, secret)
}

// Run main only on execution, not on import (like tests)
if (typeof require !== 'undefined' && require.main === module) {
  main().catch((e) => {
    if (e instanceof GiteaDroneError) {
      // silence expected aborts
      console.info(e.message)
    } else throw e
  })
}
