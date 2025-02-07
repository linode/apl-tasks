import { generate as generatePassword } from 'generate-password'
import { getSecret, replaceSecret } from './k8s'

export async function checkServiceAccountSecret(
  serviceAccountSecretName: string,
  serviceAccountLogin: string,
  teamNamespace: string,
): Promise<string | undefined> {
  console.log(`Checking for secret: ${serviceAccountSecretName}!`)
  const secret = await getSecret(serviceAccountSecretName, teamNamespace)

  if (secret !== undefined) return undefined

  console.log(`Secret ${serviceAccountSecretName} could not be found!`)
  console.log(`Creating secret for ${serviceAccountSecretName}`)
  const password = generatePassword({
    length: 16,
    numbers: true,
    symbols: true,
    lowercase: true,
    uppercase: true,
    exclude: String(':,;"/=|%\\\''),
  })
  // eslint-disable-next-line object-shorthand
  await replaceSecret(serviceAccountSecretName, teamNamespace, { login: serviceAccountLogin, password: password })
  return password
}
