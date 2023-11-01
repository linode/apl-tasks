import Operator, { ResourceEventType } from '@dot-i/k8s-operator'
import { KubernetesObject } from '@dot-i/k8s-operator/node_modules/@kubernetes/client-node/dist'
import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'

// added the type property which was missing in the original KubernetesObject
interface CustomKubernetesObject extends KubernetesObject {
  type: string
}

async function createNamespacedSecret(metadata: k8s.V1ObjectMeta | undefined) {
  if (!metadata) return
  const simpleSecret = new k8s.V1Secret()
  simpleSecret.metadata = { name: `copy-${metadata?.namespace}-${metadata?.name}`, namespace: 'argocd' }
  simpleSecret.type = 'kubernetes.io/dockerconfigjson'
  try {
    try {
      simpleSecret.data = (await k8sApi.readNamespacedSecret(metadata.name!, metadata.namespace!)).body.data
    } catch (error) {
      console.debug(`Secret '${metadata.name!}' cannot be found in namespace '${metadata.namespace!}'`)
    }
    await k8sApi.createNamespacedSecret('argocd', simpleSecret)
    console.debug(`Secret '${simpleSecret.metadata.name!}' successfully created in namespace '${metadata.namespace!}'`)
  } catch (err) {
    console.debug(`Error copying secret: statuscode: ${err.response.body.code} - message: ${err.response.body.message}`)
  }
}
// todo: still need to separate between argocd and istio-system
const kc = new KubeConfig()
kc.loadFromDefault()
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
export default class MyOperator extends Operator {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  protected async init() {
    await this.watchResource('', 'v1', 'secrets', async (e) => {
      const { object } = e
      const { metadata, type } = object as CustomKubernetesObject
      if (metadata && !metadata.namespace?.startsWith('team-')) return
      if (type !== 'kubernetes.io/dockerconfigjson') return
      switch (e.type) {
        case ResourceEventType.Added: {
          await createNamespacedSecret(metadata)
          break
        }
        case ResourceEventType.Modified: {
          const simpleSecret = new k8s.V1Secret()
          simpleSecret.metadata = { name: `copy-${metadata?.namespace}-${metadata?.name}`, namespace: 'argocd' }
          simpleSecret.type = 'kubernetes.io/dockerconfigjson'
          try {
            const headers = { 'content-type': 'application/strategic-merge-patch+json' }
            try {
              simpleSecret.data = (await k8sApi.readNamespacedSecret(metadata!.name!, metadata!.namespace!)).body.data
            } catch (error) {
              console.debug(`Secret '${metadata!.name!}' cannot be found in namespace '${metadata!.namespace!}'`)
            }
            await k8sApi.patchNamespacedSecret(
              simpleSecret.metadata.name!,
              'argocd',
              simpleSecret,
              undefined,
              undefined,
              undefined,
              undefined,
              { headers },
            )
            console.debug(
              `Secret '${simpleSecret.metadata.name!}' successfully patched in namespace '${metadata!.namespace!}'`,
            )
          } catch (err) {
            console.debug(
              `Error patching copied secret: statuscode: ${err.response.body.code} - message: ${err.response.body.message}`,
            )
            if (err.response.body.code === 404) {
              console.debug('Creating one instead')
              await createNamespacedSecret(metadata)
            }
          }
          break
        }
        case ResourceEventType.Deleted: {
          try {
            await k8sApi.deleteNamespacedSecret(`copy-${metadata?.namespace}-${metadata?.name}`, 'argocd')
            console.debug(
              `Secret 'copy-${metadata?.namespace}-${metadata?.name}' successfully deleted in namespace '${metadata!
                .namespace!}'`,
            )
          } catch (err) {
            console.debug(
              `Error deleting copied secret: statuscode: ${err.response.body.code} - message: ${err.response.body.message}`,
            )
          }
          break
        }
        default:
          break
      }
    })
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()
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
