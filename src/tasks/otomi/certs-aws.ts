import * as k8s from '@kubernetes/client-node'
import map from 'lodash/lang'
import AWS, { ACM } from 'aws-sdk'
import { cleanEnv, CERT_ROTATION_DAYS, DOMAINS, REGION, SECRETS_NAMESPACE } from '../../validators'
import { ImportCertificateRequest, ImportCertificateResponse } from 'aws-sdk/clients/acm'
// eslint-disable-next-line @typescript-eslint/unbound-method
const env = cleanEnv({
  CERT_ROTATION_DAYS,
  DOMAINS,
  REGION,
  SECRETS_NAMESPACE,
})
AWS.config.update({ region: env.REGION })
const acm = new ACM()
const cmName = 'cert-arns'
const errors = []
const kc = new k8s.KubeConfig()
kc.loadFromDefault()
const client = kc.makeApiClient(k8s.CoreV1Api)
const netClient = kc.makeApiClient(k8s.NetworkingV1beta1Api)

async function getDomains(): Promise<any> {
  try {
    const res = await client.readNamespacedConfigMap(cmName, 'maintenance')
    const { body }: { body: k8s.V1ConfigMap } = res
    return JSON.parse(body.data.domains)
  } catch (e) {
    return {}
  }
}

async function updateConfig(domains): Promise<any> {
  const body = { data: { domains: JSON.stringify(domains) } }
  const res = await client.patchNamespacedConfigMap(cmName, 'maintenance', body)
  const { body: data }: { body: k8s.V1Secret } = res
  return data
}

async function getTLSSecret(secretName: string): Promise<any> {
  try {
    const res = await client.readNamespacedSecret(secretName, env.SECRETS_NAMESPACE)
    const { body: secret }: { body: k8s.V1Secret } = res
    return secret.data
  } catch (e) {
    console.error(`Secret not found: ${secretName}`, e)
  }
}

async function importCert(secret, certArn?): Promise<string> {
  const { ['ca.crt']: ca64, ['tls.crt']: certChain64, ['tls.key']: key64 } = secret
  const ca = ca64 !== '' ? Buffer.from(ca64, 'base64').toString('ascii') : undefined
  const certChain = Buffer.from(certChain64, 'base64').toString('ascii')
  const key = Buffer.from(key64, 'base64').toString('ascii')
  const del = '-----END CERTIFICATE----'
  const certs = certChain.split(del)
  const params: ImportCertificateRequest = {
    Certificate: `${certs[0]}${del}`,
    PrivateKey: key,
    CertificateChain: ca ? ca : `${certs[1]}${del}`,
  }
  if (certArn) params.CertificateArn = certArn
  try {
    const res: ImportCertificateResponse = await acm.importCertificate(params).promise()
    const { CertificateArn } = res
    return CertificateArn
  } catch (e) {
    errors.push(e)
  }
}

async function patchIngress(arns): Promise<void> {
  const params = {
    metadata: {
      annotations: {
        'alb.ingress.kubernetes.io/certificate-arn': arns,
      },
    },
  }
  await netClient.patchNamespacedIngress('merged-ingress', 'ingress', params)
}

async function main() {
  try {
    const domains = await getDomains()
    for await (const domInfo of env.DOMAINS) {
      const domain = domInfo.domain
      const certName = domInfo.certName || domain.replace(/\./g, '-')
      const running = domains[domain]
      const now = new Date().getTime()
      // is this domain found in our registry?
      if (running) {
        // yes...maybe rotate?
        const rotationPeriodMillis = env.CERT_ROTATION_DAYS * 24 * 60 * 60 * 1000
        if (running.date < now - rotationPeriodMillis) {
          const secret = await getTLSSecret(certName)
          running.arn = await importCert(secret, running.certArn)
          running.date = now
        }
      } else {
        let arn
        if (domInfo.certArn) {
          arn = domInfo.certArn
        } else {
          // import for first time
          const secret = await getTLSSecret(certName)
          arn = await importCert(secret)
        }
        domains[domain] = {
          arn,
          date: now,
        }
      }
    }
    await updateConfig(domains)
    const arns = map(domains, 'arn').join(',')
    console.log('Patching ingress with new cert arns: ', arns)
    await patchIngress(arns)
  } catch (e) {
    errors.push(e)
    console.error('Errors found: ', errors)
  }
}
main()
