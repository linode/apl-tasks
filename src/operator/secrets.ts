import Operator, { ResourceEvent } from '@dot-i/k8s-operator'
import { KubeConfig, Watch } from '@kubernetes/client-node'

const teamNamespace = []

const watchTeamSecrets = async (event: ResourceEvent) => {
  // Filter by secret type TLS, and Dockerconfig
}
const watchNamespaces = async (event: ResourceEvent) => {}

export default class MyOperator extends Operator {
  protected async init() {
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
  const watch = new Watch(new KubeConfig())
  watch.watch()
}
