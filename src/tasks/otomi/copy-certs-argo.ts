import { V1Secret, V1SecretList } from '@kubernetes/client-node'
import { IncomingMessage } from 'http'
import { k8s } from '../../k8s'
import { cleanEnv, TEAM_IDS } from '../../validators'

const env = cleanEnv({
  TEAM_IDS,
})

const targetNamespace = 'argocd'

const processed: string[] = []

export const targetPullSecretsFilter = ({ metadata }: V1Secret): boolean => metadata!.name!.indexOf(`copy-`) === 0

// Returns list of names of all pull secrets in the target namespace that were created before.
export const getTargetPullSecretNames = async (): Promise<string[]> => {
  const targetPullSecretsRes = await k8s
    .core()
    .listNamespacedSecret(targetNamespace, undefined, undefined, undefined, 'type=kubernetes.io/dockerconfigjson')
  const { body: pullSecrets }: { body: V1SecretList } = targetPullSecretsRes
  const targetPullSecretNames = pullSecrets.items
    .filter(targetPullSecretsFilter)
    .map((s: V1Secret) => s.metadata!.name!)
  console.debug(`Found the following pull secrets in the namespace "${targetNamespace}": ${targetPullSecretNames}`)
  return targetPullSecretNames
}

export const createTargetPullSecret = (
  name: string,
  teamId: string,
  data: Record<string, any>,
): Promise<{ response: IncomingMessage; body: V1Secret }> => {
  console.info(`Creating Pull secret "${targetNamespace}/${name}"`)
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
    type: 'kubernetes.io/dockerconfigjson',
    data,
  }
  return k8s.core().createNamespacedSecret(targetNamespace, newSecret)
}

export const copyTeamPullSecrets = async (teamId: string, targetPullSecretNames: string[]): Promise<void> => {
  console.info(`Copying Pull secrets from team-${teamId} to ${targetNamespace} namespace`)
  const namespace = `team-${teamId}`
  const getTargetSecretName = (name) => `copy-${teamId}-${name}`
  // get all target namespace Pull secrets
  const {
    body: { items: teamPullSecrets },
  } = await k8s
    .core()
    .listNamespacedSecret(namespace, undefined, undefined, undefined, 'type=kubernetes.io/dockerconfigjson')
  // create new ones if not existing
  await Promise.all(
    teamPullSecrets
      .filter(({ metadata }) => !targetPullSecretNames.includes(getTargetSecretName(metadata!.name)))
      .map(({ metadata, data }) => {
        const name = getTargetSecretName(metadata!.name)
        return createTargetPullSecret(name, teamId, data as Record<string, any>)
      }),
  )
  console.info(`Finished copying Pull secrets from team-${teamId}`)
  // update processed list for pruning later
  teamPullSecrets.map(({ metadata }) => processed.push(getTargetSecretName(metadata!.name as string)))
}

export const prunePullSecrets = async (targetPullSecretNames: string[]): Promise<void> => {
  const prunableTargetSecrets = targetPullSecretNames.filter((name) => !processed.includes(name))
  await Promise.all(
    prunableTargetSecrets.map((name) => {
      console.info(`Pruning Harbor pull secret "${targetNamespace}/${name}"`)
      return k8s.core().deleteNamespacedSecret(name, targetNamespace)
    }),
  )
}

const main = async (): Promise<void> => {
  try {
    const targetPullSecretNames = await getTargetPullSecretNames()
    await Promise.all(
      env.TEAM_IDS.map((teamId) => {
        return copyTeamPullSecrets(teamId, targetPullSecretNames)
      }),
    )
    await prunePullSecrets(targetPullSecretNames)
  } catch (e) {
    throw new Error(`One or more errors occurred copying pull secrets: ${JSON.stringify(e)}`)
  }
}

main()
