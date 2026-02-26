import { HttpBearerAuth, RobotApi, RobotCreate } from '@linode/harbor-client-node'
import { randomBytes } from 'crypto'
import {
  createBuildsK8sSecret,
  createDockerconfigjsonSecret,
  createK8sSecret,
  getSecret,
  replaceSecret,
} from '../../k8s'
import {
  dockerConfigKey,
  projectBuildPushSecretName,
  projectPullSecretName,
  projectPushSecretName,
  robotPrefix,
  systemSecretName,
} from './const'
import { HarborConfig, upsertRobotAccountWithToken } from './harbor-api'
import fullRobotPermissions from './harbor-full-robot-system-permissions.json'
import { buildDockerConfigJson, generateRobotAccount, parseDockerConfigJson, stripRobotPrefix } from './helpers'
import { RobotAccountRef } from './types'

export interface HarborRobotDeps {
  desiredConfig: HarborConfig
  robotApiClient: RobotApi
  systemNamespace: string
  systemRobotName: string
  errors: string[]
}

type SecretStringData = Record<string, string>
type LegacySecretData = SecretStringData & {
  name?: string
  secret?: string
}

function generateRobotToken(): string {
  return randomBytes(32).toString('hex')
}

export async function getBearerToken(deps: HarborRobotDeps): Promise<HttpBearerAuth> {
  const { desiredConfig, robotApiClient, systemNamespace, systemRobotName, errors } = deps
  const bearerAuth: HttpBearerAuth = new HttpBearerAuth()

  const secretData = (await getSecret(systemSecretName, systemNamespace)) as LegacySecretData | undefined
  const preferredRobotName = `${robotPrefix}${systemRobotName}`

  if (!secretData) {
    const token = generateRobotToken()
    const spec = generateRobotAccount(systemRobotName, fullRobotPermissions, {
      level: 'system',
      kind: 'system',
    })
    await upsertRobotAccountWithToken(robotApiClient, errors, robotPrefix, spec, token)
    await createDockerconfigjsonSecret({
      namespace: systemNamespace,
      name: systemSecretName,
      server: desiredConfig.harborBaseRepoUrl,
      username: preferredRobotName,
      password: token,
    })
    bearerAuth.accessToken = token
    return bearerAuth
  }

  let creds = parseDockerConfigJson(secretData, desiredConfig.harborBaseRepoUrl)
  if (!creds && secretData.name && secretData.secret) {
    const dockerConfigJson = buildDockerConfigJson(desiredConfig.harborBaseRepoUrl, secretData.name, secretData.secret)
    await replaceSecret(
      systemSecretName,
      systemNamespace,
      { [dockerConfigKey]: dockerConfigJson },
      'kubernetes.io/dockerconfigjson',
    )
    creds = { username: secretData.name, password: secretData.secret }
  }
  if (!creds) {
    const token = generateRobotToken()
    const spec = generateRobotAccount(systemRobotName, fullRobotPermissions, {
      level: 'system',
      kind: 'system',
    })
    await upsertRobotAccountWithToken(robotApiClient, errors, robotPrefix, spec, token)
    await replaceSecret(
      systemSecretName,
      systemNamespace,
      { [dockerConfigKey]: buildDockerConfigJson(desiredConfig.harborBaseRepoUrl, preferredRobotName, token) },
      'kubernetes.io/dockerconfigjson',
    )
    bearerAuth.accessToken = token
    return bearerAuth
  }

  const spec = generateRobotAccount(stripRobotPrefix(creds.username), fullRobotPermissions, {
    level: 'system',
    kind: 'system',
  })
  await upsertRobotAccountWithToken(robotApiClient, errors, robotPrefix, spec, creds.password)
  bearerAuth.accessToken = creds.password
  return bearerAuth
}

async function createTeamPullRobotAccount(
  deps: HarborRobotDeps,
  projectName: string,
  token: string,
): Promise<RobotAccountRef> {
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
  return upsertRobotAccountWithToken(deps.robotApiClient, deps.errors, robotPrefix, projectRobot, token)
}

async function createTeamPushRobotAccount(
  deps: HarborRobotDeps,
  projectName: string,
  token: string,
): Promise<RobotAccountRef> {
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
  return upsertRobotAccountWithToken(deps.robotApiClient, deps.errors, robotPrefix, projectRobot, token)
}

async function createTeamBuildPushRobotAccount(
  deps: HarborRobotDeps,
  projectName: string,
  token: string,
): Promise<RobotAccountRef> {
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
  return upsertRobotAccountWithToken(deps.robotApiClient, deps.errors, robotPrefix, projectRobot, token)
}

export async function ensureTeamPullRobotAccountSecret(
  deps: HarborRobotDeps,
  namespace: string,
  projectName: string,
): Promise<void> {
  const k8sSecret = await getSecret(projectPullSecretName, namespace)
  if (!k8sSecret) {
    const token = generateRobotToken()
    const robotPullAccount = await createTeamPullRobotAccount(deps, projectName, token)
    console.debug(`Creating pull secret/${projectPullSecretName} at ${namespace} namespace`)
    await createK8sSecret({
      namespace,
      name: projectPullSecretName,
      server: `${deps.desiredConfig.harborBaseRepoUrl}`,
      username: robotPullAccount.name,
      password: token,
    })
  } else {
    const creds = parseDockerConfigJson(k8sSecret as SecretStringData, deps.desiredConfig.harborBaseRepoUrl)
    if (creds) {
      await createTeamPullRobotAccount(deps, projectName, creds.password)
    }
  }
}

export async function ensureTeamPushRobotAccountSecret(
  deps: HarborRobotDeps,
  namespace: string,
  projectName: string,
): Promise<void> {
  const k8sSecret = await getSecret(projectPushSecretName, namespace)
  if (!k8sSecret) {
    const token = generateRobotToken()
    const robotPushAccount = await createTeamPushRobotAccount(deps, projectName, token)
    console.debug(`Creating push secret/${projectPushSecretName} at ${namespace} namespace`)
    await createK8sSecret({
      namespace,
      name: projectPushSecretName,
      server: `${deps.desiredConfig.harborBaseRepoUrl}`,
      username: robotPushAccount.name,
      password: token,
    })
  } else {
    const creds = parseDockerConfigJson(k8sSecret as SecretStringData, deps.desiredConfig.harborBaseRepoUrl)
    if (creds) {
      await createTeamPushRobotAccount(deps, projectName, creds.password)
    }
  }
}

export async function ensureTeamBuildPushRobotAccountSecret(
  deps: HarborRobotDeps,
  namespace: string,
  projectName: string,
): Promise<void> {
  const k8sSecret = await getSecret(projectBuildPushSecretName, namespace)
  if (!k8sSecret) {
    const token = generateRobotToken()
    const robotBuildsPushAccount = await createTeamBuildPushRobotAccount(deps, projectName, token)
    console.debug(`Creating build push secret/${projectBuildPushSecretName} at ${namespace} namespace`)
    await createBuildsK8sSecret({
      namespace,
      name: projectBuildPushSecretName,
      server: `${deps.desiredConfig.harborBaseRepoUrl}`,
      username: robotBuildsPushAccount.name,
      password: token,
    })
  } else {
    const creds = parseDockerConfigJson(k8sSecret as SecretStringData, deps.desiredConfig.harborBaseRepoUrl)
    if (creds) {
      await createTeamBuildPushRobotAccount(deps, projectName, creds.password)
    }
  }
}
