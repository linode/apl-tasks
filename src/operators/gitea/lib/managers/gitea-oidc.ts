import { CoreV1Api, Exec, KubeConfig, V1Status } from '@kubernetes/client-node'
import stream from 'stream'
import { GiteaConfig } from '../../gitea'
import { buildTeamString } from '../helpers'

async function getGiteaPodName(kubeConfig: KubeConfig, namespace: string): Promise<string | undefined> {
  const k8sApi = kubeConfig.makeApiClient(CoreV1Api)
  const giteaPods = await k8sApi.listNamespacedPod({
    namespace,
    labelSelector: 'app.kubernetes.io/instance=gitea,app.kubernetes.io/name=gitea',
    limit: 1,
  })
  if (giteaPods.items.length === 0) {
    console.debug('Not ready for setting up OIDC config: Gitea pod not found.')
    return
  }
  return giteaPods.items[0].metadata?.name
}

export async function setGiteaOIDCConfig(giteaConfig: GiteaConfig, kubeConfig: KubeConfig, update = false) {
  if (!giteaConfig.oidcClientId || !giteaConfig.oidcClientSecret || !giteaConfig.oidcEndpoint) return
  const podNamespace = 'gitea'
  const clientID = giteaConfig.oidcClientId
  const clientSecret = giteaConfig.oidcClientSecret
  const discoveryURL = `${giteaConfig.oidcEndpoint}/.well-known/openid-configuration`
  const teamNamespaceString = buildTeamString(giteaConfig.teamNames)

  const podName = await getGiteaPodName(kubeConfig, podNamespace)
  if (!podName) {
    console.debug('Not ready for setting up OIDC config: Name of Gitea pod not found.')
    return
  }

  try {
    // WARNING: Dont enclose the teamNamespaceString in double quotes, this will escape the string incorrectly and breaks OIDC group mapping in gitea
    const execCommand = [
      'sh',
      '-c',
      `
      AUTH_ID=$(gitea admin auth list --vertical-bars | grep -E "\\|otomi-idp\\s+\\|" | grep -iE "\\|OAuth2\\s+\\|" | awk -F " " '{print $1}' | tr -d '\\n')
      if [ -z "$AUTH_ID" ]; then
        echo "Gitea OIDC config not found. Adding OIDC config for otomi-idp."
        gitea admin auth add-oauth --name "otomi-idp" --key "${clientID}" --secret "${clientSecret}" --auto-discover-url "${discoveryURL}" --provider "openidConnect" --admin-group "platform-admin" --group-claim-name "groups" --group-team-map '${teamNamespaceString}'
      elif ${update}; then
        echo "Gitea OIDC config is different. Updating OIDC config for otomi-idp."
        gitea admin auth update-oauth --id "$AUTH_ID" --key "${clientID}" --secret "${clientSecret}" --auto-discover-url "${discoveryURL}" --group-team-map '${teamNamespaceString}'
      else
        echo "Gitea OIDC config is up to date."
      fi
      `,
    ]
    const exec = new Exec(kubeConfig)
    const outputStream = new stream.PassThrough()
    let output = ''
    outputStream.on('data', (chunk) => {
      output += chunk.toString()
    })
    // Run gitea CLI command to create/update the gitea oauth configuration
    await exec
      .exec(
        podNamespace,
        podName,
        'gitea',
        execCommand,
        outputStream,
        process.stderr as stream.Writable,
        process.stdin as stream.Readable,
        false,
        (status: V1Status) => {
          console.info(output.trim())
          console.info('Gitea OIDC config status:', status.status)
        },
      )
      .catch((error) => {
        console.debug('Error occurred during exec:', error)
        throw error
      })
  } catch (error) {
    console.debug(`Error Gitea OIDC config: ${error.message}`)
    throw error
  }
}
