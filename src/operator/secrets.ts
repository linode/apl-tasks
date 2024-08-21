import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'
import { KubernetesObject } from '@kubernetes/client-node/dist'
import Operator, { ResourceEvent, ResourceEventType } from '@linode/apl-k8s-operator'

// added the type property which was missing in the original KubernetesObject
interface CustomKubernetesObject extends KubernetesObject {
  type: string
}

async function createNamespacedSecret(
  metadata: k8s.V1ObjectMeta | undefined,
  targetNamespace: string,
  secretType: string,
  secretName: string,
) {
  if (!metadata) return
  const simpleSecret = new k8s.V1Secret()
  simpleSecret.metadata = { name: secretName, namespace: targetNamespace }
  simpleSecret.type = secretType
  try {
    try {
      simpleSecret.data = (await k8sApi.readNamespacedSecret(metadata.name!, metadata.namespace!)).body.data
    } catch (error) {
      console.debug(`Secret '${metadata.name!}' cannot be found in namespace '${metadata.namespace!}'`)
    }
    await k8sApi.createNamespacedSecret(targetNamespace, simpleSecret)
    console.debug(`Secret '${simpleSecret.metadata.name!}' successfully created in namespace '${targetNamespace}'`)
  } catch (err) {
    // we know 409 indicates that secret already exists, ignore this code because it will only happen during start of the operator
    if (err.response.body.code === 409) return
    console.debug(`Error copying secret: statuscode: ${err.response.body.code} - message: ${err.response.body.message}`)
  }
}

async function EventSwitch(
  resourceEvent: ResourceEvent,
  metadata: k8s.V1ObjectMeta,
  targetNamespace: string,
  type: string,
  namePrefix?: string,
) {
  const secretName = namePrefix ? `${namePrefix}-${metadata?.name}` : `copy-${metadata?.namespace}-${metadata?.name}`
  switch (resourceEvent.type) {
    case ResourceEventType.Deleted: {
      try {
        await k8sApi.deleteNamespacedSecret(secretName, targetNamespace)
        console.debug(`Secret '${secretName}' successfully deleted in namespace '${targetNamespace}'`)
      } catch (err) {
        console.debug(
          `Error deleting copied secret: statuscode: ${err.response.body.code} - message: ${err.response.body.message}`,
        )
      }
      break
    }
    case ResourceEventType.Modified: {
      const simpleSecret = new k8s.V1Secret()
      simpleSecret.metadata = {
        name: secretName,
        namespace: targetNamespace,
      }
      simpleSecret.type = type
      try {
        const headers = { 'content-type': 'application/strategic-merge-patch+json' }
        try {
          simpleSecret.data = (await k8sApi.readNamespacedSecret(metadata.name!, metadata.namespace!)).body.data
        } catch (error) {
          console.debug(`Secret '${metadata.name!}' cannot be found in namespace '${metadata.namespace!}'`)
        }
        await k8sApi.patchNamespacedSecret(
          simpleSecret.metadata.name!,
          targetNamespace,
          simpleSecret,
          undefined,
          undefined,
          undefined,
          undefined,
          { headers },
        )
        console.debug(`Secret '${simpleSecret.metadata.name!}' successfully patched in namespace '${targetNamespace}'`)
        break
      } catch (err) {
        console.debug(
          `Error patching copied secret: statuscode: ${err.response.body.code} - message: ${err.response.body.message}`,
        )
        // we know 404 indicates that a secret does not exist, in this case we recreate a new one because otherwise it will not create a copy
        if (err.response.body.code !== 404) break
        console.debug('Recreating a copy of the secret')
        await createNamespacedSecret(metadata, targetNamespace, type, secretName)
        break
      }
    }
    case ResourceEventType.Added: {
      await createNamespacedSecret(metadata, targetNamespace, type, secretName)
      break
    }
    default:
      break
  }
}

const kc = new KubeConfig()
kc.loadFromDefault()
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
export default class MyOperator extends Operator {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  protected async init() {
    await this.watchResource('', 'v1', 'secrets', async (e) => {
      const { object } = e
      const { metadata, type } = object as CustomKubernetesObject
      if (metadata && metadata.namespace?.startsWith('monitoring')) {
        if (metadata && metadata.name !== 'thanos-objectstore') return
        if (type !== 'Opaque') return
        // Get all team namespaces
        const namespaces = await k8sApi.listNamespace()

        // Filter namespaces that start with the given prefix
        const teamNamespaces = namespaces.body.items
          .map((ns) => ns.metadata?.name)
          .filter((name) => name && name.startsWith('team-') && name !== 'team-admin')

        // Loop through all of them and add or delete it
        if (teamNamespaces.length === 0) return
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        teamNamespaces.forEach(async (targetNamespace: string) => {
          await EventSwitch(e, metadata, targetNamespace, type, 'copy')
        })
      }
      if (metadata && metadata.namespace?.startsWith('team-')) {
        if (type !== 'kubernetes.io/dockerconfigjson' && type !== 'kubernetes.io/tls') return
        const targetNamespace = type === 'kubernetes.io/dockerconfigjson' ? 'argocd' : 'istio-system'
        await EventSwitch(e, metadata, targetNamespace, type)
      }
    })
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()
  console.info(`Listening to secrets changes in all namespaces`)
  console.info('Setting up namespace prefix filter to "team-"')
  await operator.start()
  // load teams
  // load secrets
  const exit = (reason: string) => {
    operator.stop()
    process.exit(0)
  }

  process.on('SIGTERM', () => exit('SIGTERM')).on('SIGINT', () => exit('SIGINT'))
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
