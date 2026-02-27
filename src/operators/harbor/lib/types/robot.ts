// Interfaces
export interface RobotSecret {
  id: number
  name: string
  secret: string
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
