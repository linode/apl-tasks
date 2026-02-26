import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'

export function createCoreV1Api(): k8s.CoreV1Api {
  const kc = new KubeConfig()
  if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
    kc.loadFromCluster()
  } else {
    kc.loadFromDefault()
  }
  return kc.makeApiClient(k8s.CoreV1Api)
}

import { HarborConfig } from './harbor-api'
import { HarborConfigMapData, HarborSecretData } from './types'
import { validateConfigMapData, validateSecretData } from './validators'

export async function syncOperatorInputs(
  k8sApi: k8s.CoreV1Api,
  harborOperatorNamespace: string,
  operatorSecretName: string,
  operatorConfigMapName: string,
): Promise<HarborConfig> {
  let harborSecretData: HarborSecretData
  let harborConfigMapData: HarborConfigMapData

  try {
    const secretRes = await k8sApi.readNamespacedSecret({
      name: operatorSecretName,
      namespace: harborOperatorNamespace,
    })
    if (!secretRes.data) {
      throw new Error(`No data in secret: ${operatorSecretName}`)
    }
    harborSecretData = validateSecretData(secretRes.data || {})
  } catch {
    console.error(`Unable to read secret ${operatorSecretName} in namespace ${harborOperatorNamespace}`)
    throw new Error(`Harbor operator cannot read necessary configuration from secret ${operatorSecretName}`)
  }

  try {
    const configMapRes = await k8sApi.readNamespacedConfigMap({
      name: operatorConfigMapName,
      namespace: harborOperatorNamespace,
    })
    if (!configMapRes.data) {
      throw new Error(`No data in configmap: ${operatorConfigMapName}`)
    }
    harborConfigMapData = validateConfigMapData(configMapRes.data || {})
  } catch {
    console.error(`Unable to read configmap ${operatorConfigMapName} in namespace ${harborOperatorNamespace}`)
    throw new Error(`Harbor operator cannot read necessary configuration from configmap ${operatorConfigMapName}`)
  }

  return new HarborConfig(harborSecretData, harborConfigMapData)
}
