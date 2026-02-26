import { set } from 'lodash'
import { HarborConfigMapData, HarborSecretData } from './types'

export function validateConfigMapData(data: Record<string, string>): HarborConfigMapData {
  const stringFields: (keyof HarborConfigMapData)[] = [
    'harborBaseRepoUrl',
    'oidcUserClaim',
    'oidcGroupsClaim',
    'oidcName',
    'oidcScope',
  ]
  const boolFields = ['oidcVerifyCert', 'oidcAutoOnboard'] as const

  const result: HarborConfigMapData = {} as HarborConfigMapData

  for (const field of stringFields) {
    if (!data[field]) throw new Error(`Missing required configmap field "${field}"`)
    set(result, field, data[field])
  }

  for (const field of boolFields) {
    if (!data[field]) throw new Error(`Missing required configmap field "${field}"`)
    if (data[field] !== 'true' && data[field] !== 'false') {
      throw new Error(`Invalid boolean value "${data[field]}" for configmap field "${field}"`)
    }
    result[field] = data[field] === 'true'
  }

  if (data.teamNamespaces) {
    let parsed: unknown
    try {
      parsed = JSON.parse(data.teamNamespaces)
    } catch {
      throw new Error(`Invalid JSON for configmap field "teamNamespaces"`)
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`Configmap field "teamNamespaces" is not a JSON array`)
    }
    result.teamNamespaces = parsed as string[]
  }

  return result
}

export function validateSecretData(data: Record<string, string>): HarborSecretData {
  const secretFields: (keyof HarborSecretData)[] = [
    'harborUser',
    'harborPassword',
    'oidcClientId',
    'oidcClientSecret',
    'oidcEndpoint',
  ]
  const decoded: HarborSecretData = {} as HarborSecretData
  for (const field of secretFields) {
    if (!data[field]) throw new Error(`Missing required secret field "${field}"`)
    try {
      decoded[field] = Buffer.from(data[field], 'base64').toString()
    } catch {
      throw new Error(`Invalid base64 value for secret field "${field}"`)
    }
  }
  return decoded
}
