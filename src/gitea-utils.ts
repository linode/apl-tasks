import { generate as generatePassword } from 'generate-password'
import { createSecret, getSecret } from './k8s'

export async function checkServiceAccountSecret(serviceAccount: string): Promise<string | undefined> {
  console.log(`Checking for secret: ${serviceAccount}!`)
  const secret = await getSecret(serviceAccount, 'gitea')

  if (secret !== undefined) return undefined

  console.log(`Secret ${serviceAccount} could not be found!`)
  console.log(`Creating secret for ${serviceAccount}`)
  const password = generatePassword({
    length: 16,
    numbers: true,
    symbols: true,
    lowercase: true,
    uppercase: true,
    exclude: String(':,;"/=|%\\\''),
  })
  // eslint-disable-next-line object-shorthand
  await createSecret(serviceAccount, 'gitea', { login: serviceAccount, password: password })
  return password
}
