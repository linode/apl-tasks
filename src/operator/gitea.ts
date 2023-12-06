import Operator from '@dot-i/k8s-operator'
import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'

const kc = new KubeConfig()
kc.loadFromDefault()
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

function buildTeamString(teamNames: any[]): string {
  if (teamNames === undefined) return '{}'
  let result = '{'

  for (let i = 0; i < teamNames.length; i++) {
    const teamName = teamNames[i]
    const teamObject = `"/${teamName}":{"otomi":["otomi-viewer", "${teamName}"]}`

    if (i === teamNames.length - 1) {
      // If it's the last team name, don't add a comma
      result += teamObject
    } else {
      result += `${teamObject}, `
    }
  }

  result += '}'
  return result
}

export default class MyOperator extends Operator {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  protected async init() {
    await this.watchResource('', 'v1', 'namespaces', async (e) => {
      const { object } = e
      const { metadata } = object
      if (metadata && !metadata.namespace?.startsWith('team-')) return
      try {
        const namespaces = await k8sApi.listNamespace()
        const teamNamespaces = namespaces.body.items
          .map((namespace) => namespace.metadata?.name)
          .filter((name) => name && name.startsWith('team-'))
        console.info('team namespace: ', teamNamespaces)
        if (teamNamespaces.length > 0) {
          const giteaPodLabel = 'app=gitea'
          const giteaPodList = await k8sApi.listNamespacedPod(
            'gitea',
            undefined,
            undefined,
            undefined,
            undefined,
            giteaPodLabel,
          )
          const giteaPod = giteaPodList.body.items[0]
          const execCommand = `gitea admin auth update-oauth --id 1 --group-team-map ${buildTeamString(teamNamespaces)}`
          await k8sApi.connectPostNamespacedPodExec(
            giteaPod.metadata?.name || 'gitea-0',
            giteaPod.metadata?.namespace || 'gitea',
            execCommand,
            undefined,
            true,
            true,
            true,
          )
        }
      } catch (error) {
        console.debug(error)
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
