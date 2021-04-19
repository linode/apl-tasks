import http from 'http'
import * as k8s from '@kubernetes/client-node'
import { mapValues } from 'lodash'

let apiClient

export function getApiClient(): k8s.CoreV1Api {
  if (apiClient) return apiClient
  const kc = new k8s.KubeConfig()
  kc.loadFromDefault()
  apiClient = kc.makeApiClient(k8s.CoreV1Api)
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
  const secret = {
    ...new k8s.V1Secret(),
    metadata: { ...new k8s.V1ObjectMeta(), name },
    data: mapValues(data, b64enc),
  }

  await apiClient.createNamespacedSecret(namespace, secret)
  console.info(`New secret ${name} has been created in the namespace ${namespace}`)
}

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
    const { body } = await fn()
    return body
  } catch (e) {
    if (e.statusCode) {
      if (e.statusCode === statusCodeExists) console.warn(`${action} > already exists.`)
      else errors.push(`${action} > HTTP error ${e.statusCode}: ${e.message}`)
    } else errors.push(`${action} > Unknown error: ${e}`)
    return undefined
  }
}

export function handleErrors(errors: string[]) {
  if (errors.length) {
    console.error(`Errors found: ${JSON.stringify(errors, null, 2)}`)
    process.exit(1)
  } else {
    console.info('Success!')
  }
}
