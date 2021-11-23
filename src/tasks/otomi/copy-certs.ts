import { V1Secret, V1SecretList } from '@kubernetes/client-node'
import { IncomingMessage } from 'http'
import { k8sCoreClient } from '../../utils'
import { cleanEnv, OTOMI_FLAGS, TEAM_IDS } from '../../validators'

const env = cleanEnv({
  OTOMI_FLAGS,
  TEAM_IDS,
})

let targetNamespace = 'istio-system'

const processed: string[] = []

export const targetTlsSecretsFilter = ({ metadata }: V1Secret): boolean =>
  metadata!.name!.indexOf(`copy-`) === 0 && metadata!.annotations!['app.kubernetes.io/managed-by'] === 'otomi'

// Returns list of names of all TLS secrets in the target namespace that were created before.
export const getTargetTlsSecretNames = async (): Promise<string[]> => {
  const targetTlsSecretsRes = await k8sCoreClient.listNamespacedSecret(
    targetNamespace,
    undefined,
    undefined,
    undefined,
    'type=kubernetes.io/tls',
  )
  const { body: tlsSecrets }: { body: V1SecretList } = targetTlsSecretsRes
  const targetTlsSecretNames = tlsSecrets.items.filter(targetTlsSecretsFilter).map((s: V1Secret) => s.metadata!.name!)
  console.debug(`Found the following TLS secrets in the namespace "${targetNamespace}": ${targetTlsSecretNames}`)
  return targetTlsSecretNames
}

export const createTargetTlsSecret = (
  name: string,
  teamId: string,
  data: Record<string, any>,
): Promise<{ response: IncomingMessage; body: V1Secret }> => {
  console.info(`Creating TLS secret "${targetNamespace}/${name}"`)
  const newSecret: V1Secret = {
    ...new V1Secret(),
    metadata: {
      namespace: targetNamespace,
      name,
      annotations: {
        'app.kubernetes.io/managed-by': 'otomi',
        'log.otomi.io/copied-from-namespace': teamId,
      },
    },
    type: 'kubernetes.io/tls',
    data,
  }
  return k8sCoreClient.createNamespacedSecret(targetNamespace, newSecret)
}

export const copyTeamTlsSecrets = async (teamId: string, targetTlsSecretNames: string[]): Promise<void> => {
  console.info(`Copying TLS secrets from team-${teamId} to ${targetNamespace} namespace`)
  const namespace = `team-${teamId}`
  const getTargetSecretName = (name) => `copy-${teamId}-${name}`
  // get all target namespace TLS secrets
  const {
    body: { items: teamTlsSecrets },
  } = await k8sCoreClient.listNamespacedSecret(namespace, undefined, undefined, undefined, 'type=kubernetes.io/tls')
  // create new ones if not existing
  await Promise.all(
    teamTlsSecrets
      .filter(({ metadata }) => !targetTlsSecretNames.includes(getTargetSecretName(metadata!.name)))
      .map(({ metadata, data }) => {
        const name = getTargetSecretName(metadata!.name)
        return createTargetTlsSecret(name, teamId, data as Record<string, any>)
      }),
  )
  console.info(`Finished copying TLS secrets from team-${teamId}`)
  // update processed list for pruning later
  teamTlsSecrets.map(({ metadata }) => processed.push(getTargetSecretName(metadata!.name as string)))
}

export const pruneTlsSecrets = async (targetTlsSecretNames: string[]): Promise<void> => {
  const prunableTargetSecrets = targetTlsSecretNames.filter((name) => !processed.includes(name))
  await Promise.all(
    prunableTargetSecrets.map((name) => {
      console.info(`Pruning TLS secret "${targetNamespace}/${name}"`)
      return k8sCoreClient.deleteNamespacedSecret(name, targetNamespace)
    }),
  )
}

const main = async (): Promise<void> => {
  if (env.OTOMI_FLAGS.hasCloudLB) targetNamespace = 'ingress'
  try {
    const targetTlsSecretNames = await getTargetTlsSecretNames()
    await Promise.all(
      env.TEAM_IDS.map((teamId) => {
        return copyTeamTlsSecrets(teamId, targetTlsSecretNames)
      }),
    )
    await pruneTlsSecrets(targetTlsSecretNames)
  } catch (e) {
    throw new Error(`One or more errors occurred copying TLS secrets: ${JSON.stringify(e)}`)
  }
}

main()
