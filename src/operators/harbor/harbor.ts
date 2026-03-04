import * as k8s from '@kubernetes/client-node'
import { KubeConfig } from '@kubernetes/client-node'
import { ConfigureApi, HttpError, MemberApi, ProjectApi, RobotApi } from '@linode/harbor-client-node'
import { getSecret } from '../../k8s'
import { handleErrors, waitTillAvailable } from '../../utils'
import { errors } from './lib/globals'
import manageHarborOidcConfig from './lib/managers/harbor-oidc'
import manageHarborProject from './lib/managers/harbor-project'
import { ensureRobotAccount, getBearerToken } from './lib/managers/harbor-robots'
import { HarborConfig, validateConfigMapData, validateSecretData } from './lib/types/oidc'

import { error, log } from 'console'
import {
  HARBOR_ROBOT_BUILD_SUFFIX,
  HARBOR_ROBOT_PULL_SUFFIX,
  HARBOR_ROBOT_PUSH_SUFFIX,
  HARBOR_TOKEN_TYPE_PULL,
  HARBOR_TOKEN_TYPE_PUSH,
  PROJECT_BUILD_PUSH_SECRET_NAME,
  PROJECT_PULL_SECRET_NAME,
  PROJECT_PUSH_SECRET_NAME,
} from './lib/consts'
import { env } from './lib/env'

const OPERATOR_SECRET_NAME = 'apl-harbor-operator-secret'
const OPERATOR_CONFIGMAP_NAME = 'apl-harbor-operator-cm'

const harborBaseUrl = `${env.HARBOR_BASE_URL}:${env.HARBOR_BASE_URL_PORT}/api/v2.0`
const harborHealthUrl = `${harborBaseUrl}/systeminfo`
const harborOperatorNamespace = env.HARBOR_OPERATOR_NAMESPACE

const kc = new KubeConfig()
// loadFromCluster when deploying on cluster
// loadFromDefault when locally connecting to cluster
if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
  kc.loadFromCluster()
} else {
  kc.loadFromDefault()
}
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
let reconciling = false

function formatHttpError(err: HttpError): string {
  const responseWithRequest = err.response as unknown as {
    url?: string
    req?: {
      method?: string
      path?: string
      host?: string
    }
  }
  const request = responseWithRequest.req
  const method = request?.method ?? 'unknown'
  const path = request?.path ?? responseWithRequest.url ?? 'unknown'
  const host = request?.host ?? 'unknown'
  const response = typeof err.body === 'object' ? JSON.stringify(err.body) : String(err.body)
  return `Request: ${method} ${host} ${path}. Response: status code: ${err.statusCode} - ${response}`
}

interface HarborApis {
  robotApi: RobotApi
  configureApi: ConfigureApi
  projectsApi: ProjectApi
  memberApi: MemberApi
}

async function setupHarborApis(config: HarborConfig): Promise<HarborApis> {
  const robotApi = new RobotApi(config.harborUser, config.harborPassword, harborBaseUrl)
  const configureApi = new ConfigureApi(config.harborUser, config.harborPassword, harborBaseUrl)
  const projectsApi = new ProjectApi(config.harborUser, config.harborPassword, harborBaseUrl)
  const memberApi = new MemberApi(config.harborUser, config.harborPassword, harborBaseUrl)
  const bearerAuth = await getBearerToken(robotApi, env.HARBOR_SYSTEM_ROBOTNAME, env.HARBOR_SYSTEM_NAMESPACE, k8sApi)
  robotApi.setDefaultAuthentication(bearerAuth)
  configureApi.setDefaultAuthentication(bearerAuth)
  projectsApi.setDefaultAuthentication(bearerAuth)
  memberApi.setDefaultAuthentication(bearerAuth)
  return { robotApi, configureApi, projectsApi, memberApi }
}

async function syncConfig(): Promise<HarborConfig> {
  const rawSecret = (await getSecret(OPERATOR_SECRET_NAME, harborOperatorNamespace)) as Record<string, unknown>
  const secretData = validateSecretData(rawSecret)

  const configMap = await k8sApi.readNamespacedConfigMap({
    name: OPERATOR_CONFIGMAP_NAME,
    namespace: harborOperatorNamespace,
  })
  const configMapData = validateConfigMapData(configMap)

  return new HarborConfig(secretData, configMapData)
}

export default async function manageHarborProjectsAndRobotAccounts(
  namespace: string,
  harborConfig: HarborConfig,
  apis: HarborApis,
): Promise<string | null> {
  const projectName = namespace
  try {
    const projectId = await manageHarborProject(projectName, apis.projectsApi, apis.memberApi)
    if (!projectId) {
      error(`Failed to manage the project ${projectName}, skipping robot account setup`)
      return null
    }

    await ensureRobotAccount(
      namespace,
      projectName,
      harborConfig,
      apis.robotApi,
      HARBOR_ROBOT_PULL_SUFFIX,
      HARBOR_TOKEN_TYPE_PULL,
      PROJECT_PULL_SECRET_NAME,
    )
    await ensureRobotAccount(
      namespace,
      projectName,
      harborConfig,
      apis.robotApi,
      HARBOR_ROBOT_PUSH_SUFFIX,
      HARBOR_TOKEN_TYPE_PUSH,
      PROJECT_PUSH_SECRET_NAME,
    )
    await ensureRobotAccount(
      namespace,
      projectName,
      harborConfig,
      apis.robotApi,
      HARBOR_ROBOT_BUILD_SUFFIX,
      HARBOR_TOKEN_TYPE_PUSH,
      PROJECT_BUILD_PUSH_SECRET_NAME,
    )
    return projectId
  } catch (e) {
    if (e instanceof HttpError) {
      error(`Error processing project ${projectName}: ${formatHttpError(e)}`)
    } else {
      error(`Error processing project ${projectName}:`, e)
    }
    return null
  }
}

async function reconcile(): Promise<void> {
  if (reconciling) {
    log('Reconciliation already in progress, skipping this cycle')
    return
  }
  reconciling = true
  try {
    const harborConfig = await syncConfig()
    const apis = await setupHarborApis(harborConfig)
    await manageHarborOidcConfig(apis.configureApi, harborConfig)
    handleErrors(errors)
    if (harborConfig.teamNamespaces.length > 0) {
      await Promise.all(
        harborConfig.teamNamespaces.map((namespace) =>
          manageHarborProjectsAndRobotAccounts(`team-${namespace}`, harborConfig, apis),
        ),
      )
    }
  } catch (e) {
    if (e instanceof HttpError) {
      error(`Reconciliation failed: ${formatHttpError(e)}`)
    } else {
      error('Reconciliation failed:', e)
    }
  } finally {
    reconciling = false
  }
}

async function main(): Promise<void> {
  log(`Starting Harbor operator, reconciling every ${env.HARBOR_RECONCILE_INTERVAL}s`)
  await waitTillAvailable(harborHealthUrl, undefined, { confirmations: 1 })
  await reconcile()
  const intervalId = setInterval(() => {
    void reconcile()
  }, env.HARBOR_RECONCILE_INTERVAL * 1000)
  process.on('SIGTERM', () => {
    clearInterval(intervalId)
    process.exit(0)
  })
  process.on('SIGINT', () => {
    clearInterval(intervalId)
    process.exit(130)
  })
}

if (typeof require !== 'undefined' && require.main === module) {
  void main()
}
