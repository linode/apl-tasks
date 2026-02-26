import { dockerConfigKey, robotPrefix } from './const'
import { DockerConfigCredentials, GenerateRobotAccountOptions, RobotAccess, RobotAccount } from './types'

export function stripRobotPrefix(name: string): string {
  return name.startsWith(robotPrefix) ? name.slice(robotPrefix.length) : name
}

export function buildDockerConfigJson(server: string, username: string, password: string, email?: string): string {
  return JSON.stringify({
    auths: {
      [server]: {
        username,
        password,
        email: email ?? `platform@cluster.local`,
        auth: Buffer.from(`${username}:${password}`).toString('base64'),
      },
    },
  })
}

export function parseDockerConfigJson(
  secret: Record<string, any>,
  server: string,
): DockerConfigCredentials | undefined {
  const raw = secret?.[dockerConfigKey]
  if (!raw || typeof raw !== 'string') return undefined
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return undefined
  }
  const auths = parsed?.auths || {}
  const entry = auths[server] || Object.values(auths)[0]
  if (!entry) return undefined
  if (entry.username && entry.password) return { username: entry.username, password: entry.password }
  if (entry.auth) {
    const decoded = Buffer.from(entry.auth, 'base64').toString()
    const splitIndex = decoded.indexOf(':')
    if (splitIndex === -1) return undefined
    return { username: decoded.slice(0, splitIndex), password: decoded.slice(splitIndex + 1) }
  }
  return undefined
}

export function generateRobotAccount(
  name: string,
  accessList: RobotAccess[],
  options: GenerateRobotAccountOptions,
): RobotAccount {
  const {
    description = options?.description || `Robot account for ${name}`,
    level = options.level,
    kind = options.kind,
    namespace = options?.namespace || '/',
    duration = options?.duration || -1,
    disable = options?.disable || false,
  } = options || {}

  return {
    name,
    duration,
    description,
    disable,
    level,
    permissions: [
      {
        kind,
        namespace,
        access: accessList,
      },
    ],
  }
}
