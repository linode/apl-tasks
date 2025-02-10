import { generate as generatePassword } from 'generate-password'
import { createSecret, getSecret, replaceSecret } from './k8s'

export async function checkServiceAccountSecret(
  serviceAccountSecretName: string,
  serviceAccountLogin: string,
  teamNamespace: string,
): Promise<string | undefined> {
  console.log(`Checking for secret: ${serviceAccountSecretName}!`)
  const secret = await getSecret(serviceAccountSecretName, teamNamespace)
  const password = generatePassword({
    length: 16,
    numbers: true,
    symbols: true,
    lowercase: true,
    uppercase: true,
    exclude: String(':,;"/=|%\\\''),
  })
  if (secret === undefined) {
    console.log(`Secret ${serviceAccountSecretName} could not be found!`)
    console.log(`Creating secret for ${serviceAccountSecretName}`)
    await createSecret(serviceAccountSecretName, teamNamespace, { login: serviceAccountLogin, password })
  } else {
    console.log(`Replacing secret for ${serviceAccountSecretName}`)

    await replaceSecret(
      serviceAccountSecretName,
      teamNamespace,
      { login: serviceAccountLogin, password },
      'kubernetes.io/basic-auth',
    )
  }
  return password
}
