import { V1Secret } from '@kubernetes/client-node'
import { k8s } from './k8s'

// eslint-disable-next-line import/prefer-default-export
export async function setServiceAccountSecret(
  serviceAccountSecretName: string,
  serviceAccountLogin: string,
  teamNamespace: string,
  password: string,
  giteaUrl: string,
): Promise<string | undefined> {
  try {
    console.log(`Replacing secret for ${serviceAccountSecretName} in namespace ${teamNamespace}`)
    const updatedSecret: V1Secret = {
      metadata: {
        name: serviceAccountSecretName,
        namespace: teamNamespace,
        annotations: { 'tekton.dev/git-0': giteaUrl },
      },
      data: {
        username: Buffer.from(serviceAccountLogin).toString('base64'),
        password: Buffer.from(password).toString('base64'),
      },
      type: 'kubernetes.io/basic-auth',
    }
    await k8s
      .core()
      .replaceNamespacedSecret({ name: serviceAccountSecretName, namespace: teamNamespace, body: updatedSecret })
  } catch (error) {
    if (error.statusCode === 404) {
      console.log(`Secret ${serviceAccountSecretName} could not be found in namespace ${teamNamespace}!`)
      console.log(`Creating secret for ${serviceAccountSecretName} in namespace ${teamNamespace}`)
      try {
        const newSecret: V1Secret = {
          metadata: {
            name: serviceAccountSecretName,
            namespace: teamNamespace,
            annotations: { 'tekton.dev/git-0': giteaUrl },
          },
          data: {
            username: Buffer.from(serviceAccountLogin).toString('base64'),
            password: Buffer.from(password).toString('base64'),
          },
          type: 'kubernetes.io/basic-auth',
        }
        await k8s.core().createNamespacedSecret({ namespace: teamNamespace, body: newSecret })
      } catch (creatingError) {
        console.error(
          `Problem creating secret ${serviceAccountSecretName} in namespace ${teamNamespace}: ${creatingError}`,
        )
      }
    }
    console.error(`Problem replacing secret ${serviceAccountSecretName} in namespace ${teamNamespace}`)
  }
  return password
}
