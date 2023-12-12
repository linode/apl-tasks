import Operator from '@dot-i/k8s-operator'
import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'
import stream from 'stream'

const kc = new KubeConfig()
kc.loadFromCluster()
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

async function execGiteaCLICommand(object: k8s.V1Pod) {
  // Check if 'gitea-0' pod has a container named 'gitea'
  const containerStatuses = object.status?.containerStatuses || []
  const giteaContainer = containerStatuses.find((container) => container.name === 'gitea')
  // Check if the gitea container is 'READY'
  console.debug('GiteaContainer: ', giteaContainer)
  if (giteaContainer && !giteaContainer.ready) {
    console.debug('Gitea container is not ready: ', giteaContainer.state!)
    return
  }
  try {
    console.debug('Finding namespaces')
    let namespaces: any
    try {
      namespaces = (await k8sApi.listNamespace()).body
    } catch (error) {
      console.debug('No namespaces found, exited with error:', error)
    }
    console.debug('Filtering namespaces with "team-" prefix')
    let teamNamespaces: any
    try {
      teamNamespaces = namespaces.items
        .map((namespace) => namespace.metadata?.name)
        .filter((name) => name && name.startsWith('team-') && name !== 'team-admin')
    } catch (error) {
      console.debug('Teamnamespace, exited with error:', error)
    }
    if (teamNamespaces.length > 0) {
      console.debug('giteapod namespace:', object.metadata?.namespace)
      console.debug('giteapod name:', object.metadata?.name)
      console.debug('Creating exec command')
      const execCommand = [
        'sh',
        '-c',
        `gitea admin auth update-oauth --id 1 --group-team-map '${buildTeamString(teamNamespaces)}'`,
      ]
      console.debug('Trying to run the following commands:')
      console.debug(execCommand)
      if (object && object.metadata && object.metadata.namespace && object.metadata.name) {
        const exec = new k8s.Exec(kc)
        // Run gitea CLI command to update the gitea oauth group mapping
        await exec
          .exec(
            object.metadata?.namespace,
            object.metadata?.name,
            'gitea',
            execCommand,
            process.stdout as stream.Writable,
            process.stderr as stream.Writable,
            process.stdin as stream.Readable,
            false,
            (status: k8s.V1Status) => {
              console.log('Exited with status:')
              console.log(JSON.stringify(status, null, 2))
            },
          )
          .catch((error) => {
            console.debug('Error occurred during exec:', error)
          }) // needs to be done better, currently always fires
          .then(() => console.debug('Commands are executed!'))
      }
    } else {
      console.debug('No team namespaces found')
    }
  } catch (error) {
    console.debug(
      `Error updating IDP group mapping: statuscode: ${error.response.body.code} - message: ${error.response.body.message}`,
    )
  }
}

export default class MyOperator extends Operator {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  protected async init() {
    console.debug('Starting initializing')
    // Watch all pods
    try {
      await this.watchResource('', 'v1', 'namespaces', async (e) => {
        const { object } = e
        const { metadata } = object
        // Check if namespace starts with prefix 'team-'
        if (metadata && !metadata.name?.startsWith('team-')) return
        const giteaPod = (await k8sApi.readNamespacedPod('gitea-0', 'gitea')).body
        await execGiteaCLICommand(giteaPod)
      })
    } catch (error) {
      console.debug(error)
    }
    try {
      await this.watchResource('', 'v1', 'pods', async (e) => {
        const { object }: { object: k8s.V1Pod } = e
        const { metadata } = object
        // Check if pod is named 'gitea-0'
        if (metadata && metadata.name !== 'gitea-0') return
        await execGiteaCLICommand(object)
      })
    } catch (error) {
      console.debug(error)
    }
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()
  console.info(`Listening to pods and if they are 'MODIFIED'`)
  console.info(`Listening to team namespace changes in all namespaces`)
  console.info('Setting up namespace prefix filter to "team-"')
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
