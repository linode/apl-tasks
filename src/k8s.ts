import {
  CoreV1Api,
  CustomObjectsApi,
  KubeConfig,
  NetworkingV1Api,
  PatchStrategy,
  setHeaderOptions,
  V1ObjectMeta,
  V1Secret,
  V1ServiceAccount,
} from '@kubernetes/client-node'
import { IncomingMessage } from 'http'
import { findIndex, mapValues } from 'lodash'
import { PipelineKubernetesObject } from './operators/gitea/gitea'

let kc: KubeConfig
let coreClient: CoreV1Api
let networkingClient: NetworkingV1Api
let customObjectsApi: CustomObjectsApi

export const k8s = {
  kc: (): KubeConfig => {
    if (kc) return kc
    kc = new KubeConfig()
    kc.loadFromDefault()
    return kc
  },
  core: (): CoreV1Api => {
    if (coreClient) return coreClient
    coreClient = k8s.kc().makeApiClient(CoreV1Api)
    return coreClient
  },
  networking: (): NetworkingV1Api => {
    if (networkingClient) return networkingClient
    networkingClient = k8s.kc().makeApiClient(NetworkingV1Api)
    return networkingClient
  },
  customObjectsApi: (): CustomObjectsApi => {
    if (customObjectsApi) return customObjectsApi
    customObjectsApi = kc.makeApiClient(CustomObjectsApi)
    return customObjectsApi
  },
}

export async function createSecret(
  name: string,
  namespace: string,
  data: Record<string, any>,
  secretType?: string,
): Promise<void> {
  const b64enc = (val): string => Buffer.from(`${val}`).toString('base64')
  const secret: V1Secret = {
    metadata: { name },
    data: mapValues(data, b64enc) as {
      [key: string]: string
    },
  }

  await k8s.core().createNamespacedSecret({ namespace, body: secret })
  console.info(`New secret ${name} has been created in the namespace ${namespace}`)
}

export async function replaceSecret(
  name: string,
  namespace: string,
  data: Record<string, unknown>,
  secretType?: string,
): Promise<void> {
  const b64enc = (val): string => Buffer.from(`${val}`).toString('base64')
  const secret: V1Secret = {
    metadata: { name },
    data: mapValues(data, b64enc) as {
      [key: string]: string
    },
  }

  await k8s.core().replaceNamespacedSecret({
    name,
    namespace,
    body: secret,
  })
  console.info(`Secret ${name} has been patched in the namespace ${namespace}`)
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
    const response = await k8s.core().readNamespacedSecret({ name, namespace })
    const { data } = response
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
export async function createK8sSecret({
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
  const client = k8s.core()
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
    metadata: { name },
    type: 'kubernetes.io/dockerconfigjson',
    data: {
      '.dockerconfigjson': Buffer.from(JSON.stringify(data)).toString('base64'),
    },
  }

  try {
    await client.createNamespacedSecret({ namespace, body: secret })
  } catch (e) {
    throw new Error(`Secret '${name}' already exists in namespace '${namespace}'`)
  }
  // get service account we want to add the secret to as pull secret
  const saRes = await client.readNamespacedServiceAccount({
    name: 'default',
    namespace,
  })
  // add to service account if needed
  if (!saRes.imagePullSecrets) saRes.imagePullSecrets = []
  const idx = findIndex(saRes.imagePullSecrets, { name })
  if (idx === -1) {
    saRes.imagePullSecrets.push({ name })

    await client.patchNamespacedServiceAccount(
      {
        name: 'default',
        namespace,
        body: saRes,
      },
      setHeaderOptions('Content-Type', PatchStrategy.StrategicMergePatch),
    )
  }
}

/**
 * Create generic Kubernetes secret for Builds
 * @param name Secret name
 * @param namespace Kubernetes namespace
 * @param data Secret data (non encoded with base64)
 */
export async function createBuildsK8sSecret({
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
  const client = k8s.core()
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
    type: 'Opaque',
    data: {
      'config.json': Buffer.from(JSON.stringify(data)).toString('base64'),
    },
  }

  try {
    await client.createNamespacedSecret({ namespace, body: secret })
  } catch (e) {
    throw new Error(`Secret '${name}' already exists in namespace '${namespace}'`)
  }
}

export async function getSecrets(namespace: string): Promise<Array<any>> {
  const client = k8s.core()
  const saRes = await client.readNamespacedServiceAccount({ name: 'default', namespace })
  return (saRes.imagePullSecrets || []) as Array<any>
}

export async function deleteSecret(namespace: string, name: string): Promise<void> {
  const client = k8s.core()
  const saRes = await client.readNamespacedServiceAccount({ name: 'default', namespace })
  const idx = findIndex(saRes.imagePullSecrets, { name })
  if (idx > -1) {
    saRes.imagePullSecrets!.splice(idx, 1)
    await client.patchNamespacedServiceAccount(
      {
        name: 'default',
        namespace,
        body: saRes,
      },
      setHeaderOptions('Content-Type', PatchStrategy.StrategicMergePatch),
    )
  }
  try {
    await client.deleteNamespacedSecret({ name, namespace })
  } catch (e) {
    throw new Error(`Secret '${name}' does not exist in namespace '${namespace}'`)
  }
}

export async function getTektonPipeline(
  pipelineName: string,
  namespace: string,
): Promise<PipelineKubernetesObject | undefined> {
  try {
    const pipeline = await k8s.customObjectsApi().getNamespacedCustomObject({
      group: 'tekton.dev',
      version: 'v1',
      namespace,
      plural: 'pipelines',
      name: pipelineName,
    })
    return pipeline as PipelineKubernetesObject
  } catch (error) {
    console.error(`Problem getting the pipeline: ${error}`)
  }
}
