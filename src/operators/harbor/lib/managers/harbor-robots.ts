import { CoreV1Api } from '@kubernetes/client-node'
import { HttpBearerAuth, RobotApi, RobotCreate, RobotCreated } from '@linode/harbor-client-node'
import { debug, log } from 'console'
import { createBuildsK8sSecret, createK8sSecret, createSecret, getSecret, replaceSecret } from '../../../../k8s'
import fullRobotPermissions from '../../harbor-full-robot-system-permissions.json'
import {
  DEFAULT_ROBOT_PREFIX,
  PROJECT_BUILD_PUSH_SECRET_NAME,
  PROJECT_PULL_SECRET_NAME,
  PROJECT_PUSH_SECRET_NAME,
  ROBOT_PREFIX,
  SYSTEM_SECRET_NAME,
} from '../consts'
import { errors } from '../globals'
import { HarborConfig } from '../types/oidc'
import { RobotAccess, RobotAccount, RobotSecret } from '../types/robot'

/**
 * Create Harbor system robot account that is scoped to a given Harbor project with pull access only.
 * @param projectName Harbor project name
 */
export async function createTeamPullRobotAccount(projectName: string, robotApi: RobotApi): Promise<RobotCreated> {
  const projectRobot: RobotCreate = {
    name: `${projectName}-pull`,
    duration: -1,
    description: 'Allow team to pull from its own registry',
    disable: false,
    level: 'system',
    permissions: [
      {
        kind: 'project',
        namespace: projectName,
        access: [
          {
            resource: 'repository',
            action: 'pull',
          },
        ],
      },
    ],
  }
  const fullName = `${ROBOT_PREFIX}${projectRobot.name}`

  const { body: robotList } = await robotApi.listRobot(undefined, undefined, undefined, undefined, 100)
  const existing = robotList.find((i) => i.name === fullName)

  if (existing?.id) {
    const existingId = existing.id
    try {
      log(`Deleting previous pull robot account ${fullName} with id ${existingId}`)
      await robotApi.deleteRobot(existingId)
    } catch (e) {
      errors.push(`Error deleting previous pull robot account ${fullName}: ${e}`)
    }
  }
  let robotPullAccount: RobotCreated
  try {
    log(`Creating pull robot account ${fullName} with project level permsissions`)
    const { body } = await robotApi.createRobot(projectRobot)
    robotPullAccount = body
  } catch (e) {
    errors.push(`Error creating pull robot account ${fullName}: ${e}`)
    throw e
  }
  if (!robotPullAccount?.id) {
    throw new Error(
      `RobotPullAccount already exists and should have been deleted beforehand. This happens when more than 100 robot accounts exist.`,
    )
  }
  return robotPullAccount
}

/**
 * Ensure that Harbor robot account and corresponding Kubernetes pull secret exist
 * @param namespace Kubernetes namespace where pull secret is created
 * @param projectName Harbor project name
 */
export async function ensureTeamPullRobotAccountSecret(
  namespace: string,
  projectName: string,
  harborConfig: HarborConfig,
  robotApi: RobotApi,
): Promise<void> {
  const k8sSecret = await getSecret(PROJECT_PULL_SECRET_NAME, namespace)
  if (!k8sSecret) {
    const robotPullAccount = await createTeamPullRobotAccount(projectName, robotApi)
    debug(`Creating pull secret/${PROJECT_PULL_SECRET_NAME} at ${namespace} namespace`)
    await createK8sSecret({
      namespace,
      name: PROJECT_PULL_SECRET_NAME,
      server: `${harborConfig.harborBaseRepoUrl}`,
      username: robotPullAccount.name!,
      password: robotPullAccount.secret!,
    })
  }
}

/**
 * Create Harbor system robot account that is scoped to a given Harbor project with push and push access
 * to offer team members the option to download the kubeconfig.
 * @param projectName Harbor project name
 */
export async function ensureTeamPushRobotAccount(projectName: string, robotApi: RobotApi): Promise<RobotCreated> {
  const projectRobot: RobotCreate = {
    name: `${projectName}-push`,
    duration: -1,
    description: 'Allow team to push to its own registry',
    disable: false,
    level: 'system',
    permissions: [
      {
        kind: 'project',
        namespace: projectName,
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
  const fullName = `${ROBOT_PREFIX}${projectRobot.name}`

  const { body: robotList } = await robotApi.listRobot(undefined, undefined, undefined, undefined, 100)
  const existing = robotList.find((i) => i.name === fullName)

  if (existing?.id) {
    const existingId = existing.id
    try {
      log(`Deleting previous push robot account ${fullName} with id ${existingId}`)
      await robotApi.deleteRobot(existingId)
    } catch (e) {
      errors.push(`Error deleting previous push robot account ${fullName}: ${e}`)
    }
  }

  let robotPushAccount: RobotCreated
  try {
    log(`Creating push robot account ${fullName} with project level permsissions`)
    robotPushAccount = (await robotApi.createRobot(projectRobot)).body
  } catch (e) {
    errors.push(`Error creating push robot account ${fullName}: ${e}`)
    throw e
  }
  if (!robotPushAccount?.id) {
    throw new Error(
      `RobotPushAccount already exists and should have been deleted beforehand. This happens when more than 100 robot accounts exist.`,
    )
  }
  return robotPushAccount
}

/**
 * Ensure that Harbor robot account and corresponding Kubernetes push secret exist
 * @param namespace Kubernetes namespace where push secret is created
 * @param projectName Harbor project name
 */
export async function ensureTeamPushRobotAccountSecret(
  namespace: string,
  projectName: string,
  harborConfig: HarborConfig,
  robotApi: RobotApi,
): Promise<void> {
  const k8sSecret = await getSecret(PROJECT_PUSH_SECRET_NAME, namespace)
  if (!k8sSecret) {
    const robotPushAccount = await ensureTeamPushRobotAccount(projectName, robotApi)
    debug(`Creating push secret/${PROJECT_PUSH_SECRET_NAME} at ${namespace} namespace`)
    await createK8sSecret({
      namespace,
      name: PROJECT_PUSH_SECRET_NAME,
      server: `${harborConfig.harborBaseRepoUrl}`,
      username: robotPushAccount.name!,
      password: robotPushAccount.secret!,
    })
  }
}

/**
 * Create Harbor system robot account that is scoped to a given Harbor project with push access
 * for Kaniko (used for builds) task to push images.
 * @param projectName Harbor project name
 */
export async function ensureTeamBuildsPushRobotAccount(projectName: string, robotApi: RobotApi): Promise<RobotCreated> {
  const projectRobot: RobotCreate = {
    name: `${projectName}-builds`,
    duration: -1,
    description: 'Allow builds to push images',
    disable: false,
    level: 'system',
    permissions: [
      {
        kind: 'project',
        namespace: projectName,
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
  const fullName = `${ROBOT_PREFIX}${projectRobot.name}`

  const { body: robotList } = await robotApi.listRobot(undefined, undefined, undefined, undefined, 100)
  const existing = robotList.find((i) => i.name === fullName)

  if (existing?.id) {
    const existingId = existing.id
    try {
      log(`Deleting previous build push robot account ${fullName} with id ${existingId}`)
      await robotApi.deleteRobot(existingId)
    } catch (e) {
      errors.push(`Error deleting previous build push robot account ${fullName}: ${e}`)
    }
  }

  let robotBuildsPushAccount: RobotCreated
  try {
    log(`Creating build push robot account ${fullName} with project level permsissions`)
    robotBuildsPushAccount = (await robotApi.createRobot(projectRobot)).body
  } catch (e) {
    errors.push(`Error creating build push robot account ${fullName}: ${e}`)
    throw e
  }
  if (!robotBuildsPushAccount?.id) {
    throw new Error(
      `RobotBuildsPushAccount already exists and should have been deleted beforehand. This happens when more than 100 robot accounts exist.`,
    )
  }
  return robotBuildsPushAccount
}

/**
 * Ensure that Harbor robot account and corresponding Kubernetes push secret for builds exist
 * @param namespace Kubernetes namespace where push secret is created
 * @param projectName Harbor project name
 */
export async function ensureTeamBuildPushRobotAccountSecret(
  namespace: string,
  projectName: string,
  harborConfig: HarborConfig,
  robotApi: RobotApi,
): Promise<void> {
  const k8sSecret = await getSecret(PROJECT_BUILD_PUSH_SECRET_NAME, namespace)
  if (!k8sSecret) {
    const robotBuildsPushAccount = await ensureTeamBuildsPushRobotAccount(projectName, robotApi)
    debug(`Creating build push secret/${PROJECT_BUILD_PUSH_SECRET_NAME} at ${namespace} namespace`)
    await createBuildsK8sSecret({
      namespace,
      name: PROJECT_BUILD_PUSH_SECRET_NAME,
      server: `${harborConfig.harborBaseRepoUrl}`,
      username: robotBuildsPushAccount.name!,
      password: robotBuildsPushAccount.secret!,
    })
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
