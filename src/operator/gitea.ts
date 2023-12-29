import Operator from '@dot-i/k8s-operator'
import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'
import stream from 'stream'

interface groupMapping {
  [key: string]: {
    otomi: string[]
  }
}

const kc = new KubeConfig()
// loadFromCluster when deploying on cluster
// loadFromDefault when locally connecting to cluster
kc.loadFromDefault()
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

function buildTeamString(teamNames: any[]): string {
  if (teamNames === undefined) return '{}'
  const teamObject: groupMapping = {}
  teamNames.forEach((teamName: string) => {
    teamObject[teamName] = { otomi: ['otomi-viewer', teamName] }
  })
  return JSON.stringify(teamObject)
}

async function execGiteaCLICommand(podNamespace: string, podName: string) {
  try {
    console.debug('Finding namespaces')
    let namespaces: any
    try {
      namespaces = (await k8sApi.listNamespace(undefined, undefined, undefined, undefined, 'type=team')).body
    } catch (error) {
      console.debug('No namespaces found, exited with error:', error)
    }
    console.debug('Filtering namespaces with "team-" prefix')
    let teamNamespaces: any
    try {
      teamNamespaces = namespaces.items.map((namespace) => namespace.metadata?.name)
    } catch (error) {
      console.debug('Teamnamespaces exited with error:', error)
    }
    if (teamNamespaces.length > 0) {
      const teamNamespaceString = buildTeamString(teamNamespaces)
      const execCommand = [
        'sh',
        '-c',
        `AUTH_ID=$(gitea admin auth list --vertical-bars | grep -E "\\|otomi-idp\\s+\\|" | grep -iE "\\|OAuth2\\s+\\|" | awk -F " " '{print $1}' | tr -d '\n') && gitea admin auth update-oauth --id "$AUTH_ID" --group-team-map '${teamNamespaceString}'`,
      ]
      if (podNamespace && podName) {
        const exec = new k8s.Exec(kc)
        // Run gitea CLI command to update the gitea oauth group mapping
        await exec
          .exec(
            podNamespace,
            podName,
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
            throw error
          })
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

async function runExecCommand() {
  await execGiteaCLICommand('gitea', 'gitea-0').catch(async () => {
    console.debug('Error could not run exec command')
    console.debug('Retrying in 30 seconds')
    await new Promise((resolve) => setTimeout(resolve, 30000))
    console.log('Retrying to run exec command')
    await runExecCommand()
  })
}

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
        await runExecCommand()
      })
    } catch (error) {
      console.debug(error)
    }
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()
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
