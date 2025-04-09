import * as k8s from '@kubernetes/client-node'
import { KubeConfig, PatchStrategy, setHeaderOptions } from '@kubernetes/client-node'
import { KubernetesObject } from '@kubernetes/client-node/dist'
import Operator, { ResourceEventType } from '@linode/apl-k8s-operator'

// added the type property which was missing in the original KubernetesObject
interface CustomKubernetesObject extends KubernetesObject {
  type: string
}

async function createNamespacedSecret(
  metadata: k8s.V1ObjectMeta | undefined,
  targetNamespace: string,
  secretType: string,
) {
  if (!metadata) return
  const simpleSecret = new k8s.V1Secret()
  simpleSecret.metadata = { name: `copy-${metadata?.namespace}-${metadata?.name}`, namespace: targetNamespace }
  simpleSecret.type = secretType
  try {
    try {
      simpleSecret.data = (
        await k8sApi.readNamespacedSecret({ name: metadata.name!, namespace: metadata.namespace! })
      ).data
    } catch (error) {
      console.debug(`Secret '${metadata.name!}' cannot be found in namespace '${metadata.namespace!}'`)
    }
    await k8sApi.createNamespacedSecret({ namespace: targetNamespace, body: simpleSecret })
    console.debug(`Secret '${simpleSecret.metadata.name!}' successfully created in namespace '${targetNamespace}'`)
  } catch (err) {
    // we know 409 indicates that secret already exists, ignore this code because it will only happen during start of the operator
    if (err.response.body.code === 409) return
    console.debug(`Error copying secret: statuscode: ${err.response.body.code} - message: ${err.response.body.message}`)
  }
}

const kc = new KubeConfig()
kc.loadFromDefault()
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
export default class MyOperator extends Operator {
  protected async init() {
    await this.watchResource('', 'v1', 'secrets', async (e) => {
      const { object } = e
      const { metadata, type } = object as CustomKubernetesObject
      if (metadata && !metadata.namespace?.startsWith('team-')) return
      if (type !== 'kubernetes.io/dockerconfigjson' && type !== 'kubernetes.io/tls') return
      const targetNamespace = type === 'kubernetes.io/dockerconfigjson' ? 'argocd' : 'istio-system'
      switch (e.type) {
        case ResourceEventType.Deleted: {
          try {
            await k8sApi.deleteNamespacedSecret({
              name: `copy-${metadata?.namespace}-${metadata?.name}`,
              namespace: targetNamespace,
            })
            console.debug(
              `Secret 'copy-${metadata?.namespace}-${metadata?.name}' successfully deleted in namespace '${targetNamespace}'`,
            )
          } catch (err) {
            console.debug(
              `Error deleting copied secret: statuscode: ${err.response.body.code} - message: ${err.response.body.message}`,
            )
          }
          break
        }
        case ResourceEventType.Modified: {
          const simpleSecret = new k8s.V1Secret()
          simpleSecret.metadata = { name: `copy-${metadata?.namespace}-${metadata?.name}`, namespace: targetNamespace }
          simpleSecret.type = type
          try {
            try {
              simpleSecret.data = (
                await k8sApi.readNamespacedSecret({ name: metadata!.name!, namespace: metadata!.namespace! })
              ).data
            } catch (error) {
              console.debug(`Secret '${metadata!.name!}' cannot be found in namespace '${metadata!.namespace!}'`)
            }
            await k8sApi.patchNamespacedSecret(
              {
                name: simpleSecret.metadata.name!,
                namespace: targetNamespace,
                body: simpleSecret,
              },
              setHeaderOptions('Content-Type', PatchStrategy.StrategicMergePatch),
            )
            console.debug(
              `Secret '${simpleSecret.metadata.name!}' successfully patched in namespace '${targetNamespace}'`,
            )
            break
          } catch (err) {
            console.debug(
              `Error patching copied secret: statuscode: ${err.response.body.code} - message: ${err.response.body.message}`,
            )
            // we know 404 indicates that a secret does not exist, in this case we recreate a new one because otherwise it will not create a copy
            if (err.response.body.code !== 404) break
            console.debug('Recreating a copy of the secret')
            await createNamespacedSecret(metadata, targetNamespace, type)
            break
          }
        }
        case ResourceEventType.Added: {
          await createNamespacedSecret(metadata, targetNamespace, type)
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
