import { V1Secret } from '@kubernetes/client-node'
import { createSecret, k8s } from './k8s'

// eslint-disable-next-line import/prefer-default-export
export async function setServiceAccountSecret(
  serviceAccountSecretName: string,
  serviceAccountLogin: string,
  teamNamespace: string,
  password: string,
): Promise<string | undefined> {
  console.log(`Checking for secret: ${serviceAccountSecretName}!`)
  try {
    const secret = (await k8s.core().readNamespacedSecret(serviceAccountSecretName, teamNamespace)).body
    console.log(`Replacing secret for ${serviceAccountSecretName}`)
    const updatedSecret: V1Secret = {
      metadata: {
        name: secret.metadata?.name,
        namespace: teamNamespace,
      },
      data: {
        username: Buffer.from(serviceAccountLogin).toString('base64'),
        password: Buffer.from(password).toString('base64'),
      },
      type: secret.type,
    }
    await k8s.core().replaceNamespacedSecret(serviceAccountSecretName, teamNamespace, updatedSecret)
  } catch (error) {
    if (error.statusCode === 404) {
      console.log(`Secret ${serviceAccountSecretName} could not be found!`)
      console.log(`Creating secret for ${serviceAccountSecretName}`)
      await createSecret(
        serviceAccountSecretName,
        teamNamespace,
        { username: serviceAccountLogin, password },
        'kubernetes.io/basic-auth',
      )
    } else throw new Error(`Problem replacing secret ${serviceAccountSecretName} in namespace ${teamNamespace}`)
  }
  return password
}
