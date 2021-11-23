/* eslint-disable no-loop-func */
/* eslint-disable no-await-in-loop */
import {
  CoreV1Api,
  KubeConfig,
  NetworkingV1beta1Api,
  V1ObjectMeta,
  V1Secret,
  V1ServiceAccount
} from '@kubernetes/client-node'
import { IncomingMessage } from 'http'
import { findIndex, mapValues } from 'lodash'

const kc = new KubeConfig()
kc.loadFromDefault()
export const k8sCoreClient: CoreV1Api = kc.makeApiClient(CoreV1Api)
export const k8sNetworkingApi = kc.makeApiClient(NetworkingV1beta1Api)

export async function createSecret(name: string, namespace: string, data: Record<string, any>): Promise<void> {
  const b64enc = (val): string => Buffer.from(`${val}`).toString('base64')
  const secret: V1Secret = {
    ...new V1Secret(),
    metadata: { ...new V1ObjectMeta(), name },
    data: mapValues(data, b64enc) as {
      [key: string]: string
    },
  }

  await k8sCoreClient.createNamespacedSecret(namespace, secret)
  console.info(`New secret ${name} has been created in the namespace ${namespace}`)
}

export type SecretPromise = Promise<{
  response: IncomingMessage
  body: V1Secret
}>

export type ServiceAccountPromise = Promise<{
  response: IncomingMessage
  body: V1ServiceAccount
}>

export async function getSecret(name: string, namespace: string): Promise<unknown> {
  const b64dec = (val): string => Buffer.from(val, 'base64').toString()
  try {
    const response = await k8sCoreClient.readNamespacedSecret(name, namespace)
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

/**
 * Create Kubernetes secret
 * @param name Secret name
 * @param namespace Kubernetes namespace
 * @param data Secret data (non encoded with base64)
 */
export async function createPullSecret({
  namespace,
  name,
  server,
  password,
  username = '_json_key',
}: {
  namespace: string
  name: string
  server: string
  password: string
  username?: string
}): Promise<void> {
  const client = k8sCoreClient
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

export async function getPullSecrets(namespace: string): Promise<Array<any>> {
  const client = k8sCoreClient
  const saRes = await client.readNamespacedServiceAccount('default', namespace)
  const { body: sa }: { body: V1ServiceAccount } = saRes
  return (sa.imagePullSecrets || []) as Array<any>
}

export async function deletePullSecret(namespace: string, name: string): Promise<void> {
  const client = k8sCoreClient
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
