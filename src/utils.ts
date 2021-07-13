import http from 'http'
import { findIndex, isNil, mapValues, omitBy } from 'lodash'
import { CoreV1Api, KubeConfig, V1Secret, V1ObjectMeta, V1ServiceAccount } from '@kubernetes/client-node'
import retry, { Options } from 'async-retry'
import fetch, { RequestInit } from 'node-fetch'
import { exit } from 'process'

let apiClient: CoreV1Api

export function getApiClient(): CoreV1Api {
  if (apiClient) return apiClient
  const kc = new KubeConfig()
  kc.loadFromDefault()
  apiClient = kc.makeApiClient(CoreV1Api)
  return apiClient
}

export function objectToArray(obj: object, keyName: string, keyValue: string): any[] {
  const arr = Object.keys(obj).map((key) => {
    const tmp = {}
    tmp[keyName] = key
    tmp[keyValue] = obj[key]
    return tmp
  })
  return arr
}

export function ensure<T>(argument: T | undefined | null, message = 'This value was promised to be there.'): T {
  if (argument === undefined || argument === null) {
    throw new TypeError(message)
  }

  return argument
}

export async function createSecret(name: string, namespace: string, data: object): Promise<void> {
  const b64enc = (val): string => Buffer.from(`${val}`).toString('base64')
  const secret: V1Secret = {
    ...new V1Secret(),
    metadata: { ...new V1ObjectMeta(), name },
    data: mapValues(data, b64enc) as {
      [key: string]: string
    },
  }

  await getApiClient().createNamespacedSecret(namespace, secret)
  console.info(`New secret ${name} has been created in the namespace ${namespace}`)
}

export type SecretPromise = Promise<{
  response: http.IncomingMessage
  body: V1Secret
}>

export type ServiceAccountPromise = Promise<{
  response: http.IncomingMessage
  body: V1ServiceAccount
}>

export async function getSecret(name: string, namespace: string): Promise<object | undefined> {
  const b64dec = (val): string => Buffer.from(val, 'base64').toString()
  try {
    const response = await getApiClient().readNamespacedSecret(name, namespace)
    const {
      body: { data },
    } = response
    const secret = mapValues(data, b64dec)
    console.debug(`Found: secret ${name} in namespace ${namespace}`)
    return secret
  } catch (e) {
    console.info(`Not found: secret ${name} in namespace ${namespace}`)
    return undefined
  }
}

export type openapiResponse = {
  response: http.IncomingMessage
  body?: any
}

export async function doApiCall(
  errors: string[],
  action: string,
  fn: () => Promise<openapiResponse>,
  statusCodeExists = 409,
): Promise<any | undefined> {
  console.info(action)
  try {
    const res = await fn()
    const { body } = res
    return body
  } catch (e) {
    if (e.statusCode) {
      if (e.statusCode === statusCodeExists) console.warn(`${action} > already exists.`)
      else errors.push(`${action} > HTTP error ${e.statusCode}: ${e.message}`)
    } else errors.push(`${action} > Unknown error: ${e.message}`)
    return undefined
  }
}

export function handleErrors(errors: string[]): void {
  if (errors.length) {
    console.error(`Errors found: ${JSON.stringify(errors, null, 2)}`)
    process.exit(1)
  } else {
    console.info('Success!')
  }
}

export async function createPullSecret({
  teamId,
  name,
  server,
  password,
  username = '_json_key',
}: {
  teamId: string
  name: string
  server: string
  password: string
  username?: string
}): Promise<void> {
  const client = getApiClient()
  const namespace = `team-${teamId}`
  // create data structure for secret
  const data = {
    auths: {
      [server]: {
        username,
        password,
        email: 'not@val.id',
        auth: Buffer.from(`${username}:${password}`).toString('base64'),
      },
    },
  }
  // create the secret
  const secret = {
    ...new V1Secret(),
    metadata: { ...new V1ObjectMeta(), name },
    type: 'kubernetes.io/dockerconfigjson',
    data: {
      '.dockerconfigjson': Buffer.from(JSON.stringify(data)).toString('base64'),
    },
  }
  // eslint-disable-next-line no-useless-catch
  try {
    await client.createNamespacedSecret(namespace, secret)
  } catch (e) {
    throw new Error(`Secret '${name}' already exists in namespace '${namespace}'`)
  }
  // get service account we want to add the secret to as pull secret
  const saRes = await client.readNamespacedServiceAccount('default', namespace)
  const { body: sa }: { body: V1ServiceAccount } = saRes
  // add to service account if needed
  if (!sa.imagePullSecrets) sa.imagePullSecrets = []
  const idx = findIndex(sa.imagePullSecrets, { name })
  if (idx === -1) {
    sa.imagePullSecrets.push({ name })
    await client.patchNamespacedServiceAccount('default', namespace, sa, undefined, undefined, undefined, undefined, {
      headers: { 'content-type': 'application/strategic-merge-patch+json' },
    })
  }
}

export async function getPullSecrets(teamId: string): Promise<Array<any>> {
  const client = getApiClient()
  const namespace = `team-${teamId}`
  const saRes = await client.readNamespacedServiceAccount('default', namespace)
  const { body: sa }: { body: V1ServiceAccount } = saRes
  return (sa.imagePullSecrets || []) as Array<any>
}

export async function deletePullSecret(teamId: string, name: string): Promise<void> {
  const client = getApiClient()
  const namespace = `team-${teamId}`
  const saRes = await client.readNamespacedServiceAccount('default', namespace)
  const { body: sa }: { body: V1ServiceAccount } = saRes
  const idx = findIndex(sa.imagePullSecrets, { name })
  if (idx > -1) {
    sa.imagePullSecrets!.splice(idx, 1)
    await client.patchNamespacedServiceAccount('default', namespace, sa, undefined, undefined, undefined, undefined, {
      headers: { 'content-type': 'application/strategic-merge-patch+json' },
    })
  }
  try {
    await client.deleteNamespacedSecret(name, namespace)
  } catch (e) {
    throw new Error(`Secret '${name}' does not exist in namespace '${namespace}'`)
  }
}

const retryOptions: Options = {
  retries: 2,
  factor: 2,
  // minTimeout: The number of milliseconds before starting the first retry. Default is 1000.
  minTimeout: 3000,
  // The maximum number of milliseconds between two retries.
  maxTimeout: 10000,
}

export async function faultTolerantFetch(url: string): Promise<void> {
  try {
    await retry(async (bail) => {
      try {
        const fetchOptions: RequestInit = {
          redirect: 'follow',
        }
        const res = await fetch(url, fetchOptions)
        if (res.status !== 200) {
          console.warn(`GET ${res.url} ${res.status}`)
          bail(new Error(`Retry`))
        }
      } catch (e) {
        // Print system erros like ECONNREFUSED
        console.error(e.message)
        throw e
      }
    }, retryOptions)
  } catch (e) {
    console.log('Max retry tries has been reached')
    exit(1)
  }
}
