import Operator, { ResourceEvent, ResourceEventType } from '@dot-i/k8s-operator'
import { KubernetesObject } from '@dot-i/k8s-operator/node_modules/@kubernetes/client-node/dist'
import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'

interface CustomKubernetesObject extends KubernetesObject {
  type: string
}

const kc = new KubeConfig()
kc.loadFromDefault()
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
const teamNamespace: string[] = []
const watchTeamSecrets = async (event: ResourceEvent) => {
  // console.debug('WATCH TEAMSECRETS', event)
  const secrets = await k8sApi.listSecretForAllNamespaces()
  // Filter by secret type TLS, and Dockerconfig
}
const watchNamespaces = async (event: ResourceEvent) => {
  // console.debug('WATCH NAMESPACES', event)
  if (event.meta.name.includes('team')) {
    teamNamespace.push(event.meta.namespace!)
  }
  const secrets = await k8sApi.listSecretForAllNamespaces()
}
export default class MyOperator extends Operator {
  protected async init() {
    console.debug('Before watch resource')
    await this.watchResource('', 'v1', 'secrets', async (e) => {
      const { object } = e
      const { metadata, type } = object as CustomKubernetesObject
      if (metadata && !metadata.namespace?.startsWith('team-')) return
      if (type !== 'kubernetes.io/dockerconfigjson') return
      console.debug('------------')
      console.debug('TEAM SECRETS: ', metadata?.name)
      console.debug('EVENT-TYPE: ', e.type)
      switch (e.type) {
        case ResourceEventType.Added: {
          console.debug('ResourceEventType.Added')
          const simpleSecret = new k8s.V1Secret()
          simpleSecret.metadata = { name: `copy-${metadata?.namespace}-${metadata?.name}`, namespace: 'argocd' }
          simpleSecret.type = 'kubernetes.io/dockerconfigjson'
          // eslint-disable-next-line no-useless-catch
          try {
            simpleSecret.data = (await k8sApi.readNamespacedSecret(metadata!.name!, metadata!.namespace!)).body.data
            await k8sApi.createNamespacedSecret('argocd', simpleSecret)
            console.debug(simpleSecret.metadata.name)
          } catch (err) {
            console.debug('ERROR', err)
            console.debug(
              `Secret '${simpleSecret.metadata.name}' already exists in namespace '${simpleSecret.metadata.namespace}'`,
            )
          }
          // do something useful here
          break
        }
        case ResourceEventType.Modified:
          // do something useful here
          break
        case ResourceEventType.Deleted:
          // do something useful here
          break
        default:
          break
      }
    })
    await this.watchResource('', 'v1', 'namespaces', watchNamespaces)
    teamNamespace.forEach((namespace) => {
      this.watchResource('', 'v1', 'secrets', watchTeamSecrets, namespace)
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
