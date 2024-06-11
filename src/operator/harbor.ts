import Operator from '@dot-i/k8s-operator'
import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'

interface groupMapping {
  [key: string]: {
    otomi: string[]
  }
}

const kc = new KubeConfig()
// loadFromCluster when deploying on cluster
// loadFromDefault when locally connecting to cluster
kc.loadFromCluster()
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

export default class MyOperator extends Operator {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  protected async init() {
    // Watch all namespaces
    try {
      await this.watchResource('', 'v1', 'namespaces', async (e) => {
        const { object }: { object: k8s.V1Pod } = e
        const { metadata } = object
        // Check if namespace starts with prefix 'team-'
        if (metadata && !metadata.name?.startsWith('team-')) return
        if (metadata && metadata.name === 'team-admin') return
        await new Promise((resolve) => setTimeout(resolve, 1000))
        console.info(`Namespace:`, metadata?.name)
      })
    } catch (error) {
      console.debug(error)
    }
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()
  console.info(`Listening to team namespace changes in all namespaces`)
  await operator.start()
  const exit = (reason: string) => {
    operator.stop()
    process.exit(0)
  }

  process.on('SIGTERM', () => exit('SIGTERM')).on('SIGINT', () => exit('SIGINT'))
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
