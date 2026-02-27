import { CoreV1Api } from '@kubernetes/client-node'
import { HttpBearerAuth, Robot, RobotApi, RobotCreate, RobotCreated } from '@linode/harbor-client-node'
import { debug, error, log } from 'console'
import { randomBytes } from 'crypto'
import { createK8sSecret, createSecret, getSecret, replaceSecret } from '../../../../k8s'
import fullRobotPermissions from '../../harbor-full-robot-system-permissions.json'
import {
  DEFAULT_ROBOT_PREFIX,
  DOCKER_CONFIG_KEY,
  HARBOR_TOKEN_TYPE_PULL,
  HARBOR_TOKEN_TYPE_PUSH,
  PROJECT_PULL_SECRET_NAME,
  ROBOT_PREFIX,
  SYSTEM_SECRET_NAME,
} from '../consts'
import { errors } from '../globals'
import { handleApiError } from '../helpers'
import { HarborConfig } from '../types/oidc'
import { DockerConfigCredentials, RobotAccess, RobotAccount, RobotSecret } from '../types/robot'

function generateRobotToken(): string {
  return randomBytes(32).toString('hex')
}

async function updateRobotToken(robotApi: RobotApi, robot: Robot): Promise<void> {
  const action = `Updating robot token for ${robot.name}`
  log(action)
  if (!robot.id) {
    const errorMsg = `Cannot update robot token for ${robot.name} because it has no id`
    error(errorMsg)
    errors.push(errorMsg)
    return
  }
  if (!robot.secret) {
    const errorMsg = `Cannot update robot token for ${robot.name} because it has no secret`
    error(errorMsg)
    errors.push(errorMsg)
    return
  }

  try {
    await robotApi.updateRobot(robot.id, robot)
  } catch (e) {
    handleApiError(errors, action, e)
  }
}

export function parseDockerConfigJson(
  secret: Record<string, any>,
  server: string,
): DockerConfigCredentials | undefined {
  const raw = secret?.[DOCKER_CONFIG_KEY]
  if (!raw || typeof raw !== 'string') return undefined
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
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

/**
 * Create Harbor system robot account that is scoped to a given Harbor project with pull access only.
 * @param projectName Harbor project name
 */
export async function createRobotAccount(projectRobot: RobotCreate, robotApi: RobotApi): Promise<RobotCreated> {
  let robotAccount: RobotCreated
  try {
    log(`Creating robot account ${projectRobot.name} with project level permsissions`)
    const { body } = await robotApi.createRobot(projectRobot)
    robotAccount = body
  } catch (e) {
    errors.push(`Error creating robot account ${projectRobot.name}: ${e}`)
    throw e
  }

  return robotAccount
}

async function findRobotByName(robotApi: RobotApi, robotName: string) {
  const { body: robotList } = await robotApi.listRobot(undefined, undefined, undefined, undefined, 100)
  const existing = robotList.find((i) => i.name === robotName)
  return existing
}

function createRobotPayload(name: string, namespace: string, token: string, tokenType: string): RobotCreate {
  switch (tokenType) {
    case HARBOR_TOKEN_TYPE_PUSH:
      return {
        name,
        duration: -1,
        description: 'Allow to push to project container registry',
        disable: false,
        level: 'project',
        secret: token,
        permissions: [
          {
            kind: 'project',
            namespace,
            access: [
              {
                resource: 'repository',
                action: 'push',
              },
              {
                resource: 'repository',
                action: 'pull',
              },
            ],
          },
        ],
      }
    case HARBOR_TOKEN_TYPE_PULL:
    default:
      return {
        name,
        duration: -1,
        description: 'Allow to pull from project container registry',
        disable: false,
        level: 'project',
        secret: token,
        permissions: [
          {
            kind: 'project',
            namespace,
            access: [
              {
                resource: 'repository',
                action: 'pull',
              },
            ],
          },
        ],
      }
  }
}

/**
 * Ensure that Harbor robot account and corresponding Kubernetes pull secret exist
 * @param namespace Kubernetes namespace where pull secret is created
 * @param projectName Harbor project name
 */
export async function ensureRobotAccount(
  namespace: string,
  projectName: string,
  harborConfig: HarborConfig,
  robotApi: RobotApi,
  suffix: string,
  tokenType: string,
): Promise<void> {
  const k8sSecret = await getSecret(PROJECT_PULL_SECRET_NAME, namespace)
  const fullName = `${ROBOT_PREFIX}${projectName}-${suffix}`
  const robotName = `${projectName}-${suffix}`
  const existingRobot = await findRobotByName(robotApi, fullName)
  let robotToken = generateRobotToken()
  if (!k8sSecret) {
    debug(`Creating ${suffix} secret/${PROJECT_PULL_SECRET_NAME} at ${namespace} namespace`)
    await createK8sSecret({
      namespace,
      name: PROJECT_PULL_SECRET_NAME,
      server: `${harborConfig.harborBaseRepoUrl}`,
      username: robotName,
      password: robotToken,
    })
  } else {
    const credentials = parseDockerConfigJson(k8sSecret, harborConfig.harborBaseRepoUrl)
    if (!credentials || !credentials.password) {
      error(
        `Failed to parse credentials from existing ${suffix} secret/${PROJECT_PULL_SECRET_NAME} in ${namespace} namespace`,
      )
      return
    }
    robotToken = credentials.password
  }

  if (!existingRobot?.id) {
    log(`Creating ${suffix} robot account ${fullName} with project level permsissions`)
    const robot = createRobotPayload(robotName, projectName, robotToken, tokenType)

    await createRobotAccount(robot, robotApi)
  } else {
    existingRobot.secret = robotToken
    await updateRobotToken(robotApi, existingRobot)
  }
}

export async function ensureRobotSecretHasCorrectName(
  robotSecret: RobotSecret,
  systemRobotName: string,
  systemNamespace: string,
): Promise<void> {
  const preferredRobotName = `${ROBOT_PREFIX}${systemRobotName}`
  if (robotSecret.name !== preferredRobotName) {
    const updatedRobotSecret = { ...robotSecret, name: preferredRobotName }
    await replaceSecret(SYSTEM_SECRET_NAME, systemNamespace, updatedRobotSecret)
  }
}

/**
 * Create Harbor robot account that is used by APL tasks
 * @note assumes OIDC is not yet configured, otherwise this operation is NOT possible
 */
export async function createSystemRobotSecret(
  robotApi: RobotApi,
  systemRobotName: string,
  systemNamespace: string,
): Promise<RobotSecret> {
  const { body: robotList } = await robotApi.listRobot()
  const existing = robotList.find(
    (robot) =>
      robot.name === `${ROBOT_PREFIX}${systemRobotName}` || robot.name === `${DEFAULT_ROBOT_PREFIX}${systemRobotName}`,
  )
  if (existing?.id) {
    const existingId = existing.id
    try {
      log(`Deleting previous robot account ${systemRobotName} with id ${existingId}`)
      await robotApi.deleteRobot(existingId)
    } catch (e) {
      errors.push(`Error deleting previous robot account ${systemRobotName}: ${e}`)
    }
  }
  let robotAccount: RobotCreated
  try {
    log(`Creating robot account ${systemRobotName} with system level permsissions`)
    robotAccount = (
      await robotApi.createRobot(
        generateRobotAccount(systemRobotName, fullRobotPermissions, {
          level: 'system',
          kind: 'system',
        }),
      )
    ).body
  } catch (e) {
    errors.push(`Error creating robot account ${systemRobotName}: ${e}`)
    throw e
  }
  if (!isRobotCreated(robotAccount)) {
    throw new Error('Robot account creation failed: missing id, name, or secret')
  }
  const robotSecret: RobotSecret = { id: robotAccount.id!, name: robotAccount.name!, secret: robotAccount.secret! }
  await createSecret(SYSTEM_SECRET_NAME, systemNamespace, robotSecret)
  return robotSecret
}

/**
 * Get token by reading access token from kubernetes secret.
 * If the secret does not exists then create Harbor robot account and populate credentials to kubernetes secret.
 */
export async function getBearerToken(
  robotApi: RobotApi,
  systemRobotName: string,
  systemNamespace: string,
  k8sApi: CoreV1Api,
): Promise<HttpBearerAuth> {
  const bearerAuth: HttpBearerAuth = new HttpBearerAuth()

  let robotSecret = (await getSecret(SYSTEM_SECRET_NAME, systemNamespace)) as RobotSecret
  if (!robotSecret) {
    // not existing yet, create robot account and keep creds in secret
    robotSecret = await createSystemRobotSecret(robotApi, systemRobotName, systemNamespace)
  } else {
    await ensureRobotSecretHasCorrectName(robotSecret, systemRobotName, systemNamespace)
    // test if secret still works
    try {
      bearerAuth.accessToken = robotSecret.secret
      robotApi.setDefaultAuthentication(bearerAuth)
      await robotApi.listRobot()
    } catch (e) {
      // throw everything except 401, which is what we test for
      if (e.status !== 401) throw e
      // unauthenticated, so remove and recreate secret
      await k8sApi.deleteNamespacedSecret({ name: SYSTEM_SECRET_NAME, namespace: systemNamespace })
      // now, the next call might throw IF:
      // - authMode oidc was already turned on and a platform admin accidentally removed the secret
      // but that is very unlikely, an unresolvable problem and needs a manual db fix
      robotSecret = await createSystemRobotSecret(robotApi, systemRobotName, systemNamespace)
    }
  }
  bearerAuth.accessToken = robotSecret.secret
  return bearerAuth
}

export function isRobotCreated(obj: unknown): obj is RobotCreated {
  return typeof obj === 'object' && obj !== null && 'id' in obj && 'name' in obj && 'secret' in obj
}

export function generateRobotAccount(
  name: string,
  accessList: RobotAccess[],
  options: {
    description?: string
    level: 'project' | 'system'
    kind: 'project' | 'system'
    namespace?: string
    duration?: number
    disable?: boolean
  },
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
