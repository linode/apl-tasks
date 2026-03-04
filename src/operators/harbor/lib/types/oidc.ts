import { V1ConfigMap } from '@kubernetes/client-node'

export interface HarborSecretData {
  harborPassword: string
  harborUser: string
  oidcEndpoint: string
  oidcClientId: string
  oidcClientSecret: string
}

export interface HarborConfigMapData {
  harborBaseRepoUrl: string
  oidcAutoOnboard: boolean
  oidcUserClaim: string
  oidcGroupsClaim: string
  oidcName: string
  oidcScope: string
  oidcVerifyCert: boolean
  teamNamespaces: string[]
}

export function validateSecretData(data: Record<string, unknown>): HarborSecretData {
  const required = ['harborUser', 'harborPassword', 'oidcEndpoint', 'oidcClientId', 'oidcClientSecret']
  const missing = required.filter((key) => !data[key])
  if (missing.length > 0) throw new Error(`Missing required Harbor secret fields: ${missing.join(', ')}`)
  return {
    harborUser: data.harborUser as string,
    harborPassword: data.harborPassword as string,
    oidcEndpoint: data.oidcEndpoint as string,
    oidcClientId: data.oidcClientId as string,
    oidcClientSecret: data.oidcClientSecret as string,
  }
}

export function validateConfigMapData(configMap: V1ConfigMap): HarborConfigMapData {
  const required = [
    'harborBaseRepoUrl',
    'oidcAutoOnboard',
    'oidcUserClaim',
    'oidcGroupsClaim',
    'oidcName',
    'oidcScope',
    'oidcVerifyCert',
    'teamNamespaces',
  ]
  const { data } = configMap
  if (!data) throw new Error('Harbor configmap data is missing')
  const missing = required.filter((key) => data[key] === undefined || data[key] === '')
  if (missing.length > 0) throw new Error(`Missing required Harbor configmap fields: ${missing.join(', ')}`)
  return {
    harborBaseRepoUrl: data.harborBaseRepoUrl,
    oidcAutoOnboard: data.oidcAutoOnboard === 'true',
    oidcUserClaim: data.oidcUserClaim,
    oidcGroupsClaim: data.oidcGroupsClaim,
    oidcName: data.oidcName,
    oidcScope: data.oidcScope,
    oidcVerifyCert: data.oidcVerifyCert === 'true',
    teamNamespaces: JSON.parse(data.teamNamespaces) as string[],
  }
}

export class HarborConfig {
  harborBaseRepoUrl: string
  harborUser: string
  harborPassword: string
  oidcClientId: string
  oidcClientSecret: string
  oidcEndpoint: string
  oidcVerifyCert: boolean
  oidcUserClaim: string
  oidcAutoOnboard: boolean
  oidcGroupsClaim: string
  oidcName: string
  oidcScope: string
  teamNamespaces: string[]

  constructor(secretData: HarborSecretData, configMapData: HarborConfigMapData) {
    this.harborUser = secretData.harborUser
    this.harborPassword = secretData.harborPassword
    this.oidcEndpoint = secretData.oidcEndpoint
    this.oidcClientId = secretData.oidcClientId
    this.oidcClientSecret = secretData.oidcClientSecret
    this.harborBaseRepoUrl = configMapData.harborBaseRepoUrl
    this.oidcAutoOnboard = configMapData.oidcAutoOnboard
    this.oidcUserClaim = configMapData.oidcUserClaim
    this.oidcGroupsClaim = configMapData.oidcGroupsClaim
    this.oidcName = configMapData.oidcName
    this.oidcScope = configMapData.oidcScope
    this.oidcVerifyCert = configMapData.oidcVerifyCert
    this.teamNamespaces = configMapData.teamNamespaces
  }
}
