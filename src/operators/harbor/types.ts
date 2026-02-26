import {
  HARBOR_BASE_URL,
  HARBOR_BASE_URL_PORT,
  HARBOR_OPERATOR_NAMESPACE,
  HARBOR_SETUP_POLL_INTERVAL_SECONDS,
  HARBOR_SYSTEM_NAMESPACE,
  HARBOR_SYSTEM_ROBOTNAME,
} from '../../validators'

// Interfaces
export interface DependencyState {
  [key: string]: any
}

export const harborEnvValidators = {
  HARBOR_BASE_URL,
  HARBOR_BASE_URL_PORT,
  HARBOR_OPERATOR_NAMESPACE,
  HARBOR_SETUP_POLL_INTERVAL_SECONDS,
  HARBOR_SYSTEM_NAMESPACE,
  HARBOR_SYSTEM_ROBOTNAME,
}

export interface RobotAccess {
  resource: string
  action: string
}

export interface RobotPermission {
  kind: 'project' | 'system'
  namespace: string
  access: RobotAccess[]
}

export interface RobotAccount {
  name: string
  duration: number
  description: string
  disable: boolean
  level: 'project' | 'system'
  permissions: RobotPermission[]
}

export interface DockerConfigCredentials {
  username: string
  password: string
}

export interface RobotAccountRef {
  id: number
  name: string
}

export interface GenerateRobotAccountOptions {
  description?: string
  level: 'project' | 'system'
  kind: 'project' | 'system'
  namespace?: string
  duration?: number
  disable?: boolean
}

export interface HarborSecretData {
  harborUser: string
  harborPassword: string
  oidcClientId: string
  oidcClientSecret: string
  oidcEndpoint: string
}

export interface HarborConfigMapData {
  harborBaseRepoUrl: string
  oidcAutoOnboard: boolean
  oidcUserClaim: string
  oidcGroupsClaim: string
  oidcName: string
  oidcScope: string
  oidcVerifyCert: boolean
  teamNamespaces?: string[]
}
