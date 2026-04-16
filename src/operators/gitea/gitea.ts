/* eslint-disable no-console */
import { KubeConfig } from '@kubernetes/client-node'
import Operator, { ResourceEvent, ResourceEventType } from '@linode/apl-k8s-operator'
import {
  AdminApi,
  Configuration,
  CreateRepoOption,
  MiscellaneousApi,
  Organization,
  OrganizationApi,
  Repository,
  RepositoryApi,
} from '@linode/gitea-client-fetch'
import retry from 'async-retry'
import { isEmpty, keys } from 'lodash'
import { getSanitizedErrorMessage } from '../../utils'
import { orgName, otomiValuesRepoName } from '../common'
import { giteaEnv } from './lib/env'
import { createOrganizations } from './lib/managers/gitea-organizations'
import { errors } from './lib/globals'
import { createTeams } from './lib/managers/gitea-teams'
import { createUsers } from './lib/managers/gitea-users'
import { setGiteaOIDCConfig } from './lib/managers/gitea-oidc'
import { addTektonHook, createBuildWebHook, deleteBuildWebHook, updateBuildWebHook } from './lib/managers/gitea-webhook'
import { PipelineKubernetesObject } from './lib/types/webhook'
import { getTektonPipeline } from './lib/helpers'
import { createReposAndAddToTeam, upsertRepo } from './lib/managers/gitea-repositories'

interface DependencyState {
  giteaPassword: string | null
  teamConfig: any
  oidcClientId: string | null
  oidcClientSecret: string | null
  oidcEndpoint: string | null
  teamNames: string[] | null
}

const GITEA_ENDPOINT = `${giteaEnv.GITEA_URL}:${giteaEnv.GITEA_URL_PORT}`
export type GiteaConfig = {
  giteaPassword: string
  hasArgocd: boolean
  teamConfig: {}
  teamNames: string[]
  domainSuffix: string
  oidcClientId: string
  oidcClientSecret: string
  oidcEndpoint: string
}

const env: GiteaConfig = {
  giteaPassword: '',
  hasArgocd: false,
  teamConfig: {},
  teamNames: [] as string[],
  domainSuffix: '',
  oidcClientId: '',
  oidcClientSecret: '',
  oidcEndpoint: '',
}
let lastState: DependencyState = {
  giteaPassword: null,
  teamConfig: null,
  oidcClientId: null,
  oidcClientSecret: null,
  oidcEndpoint: null,
  teamNames: null,
}

const kc = new KubeConfig()
// loadFromCluster when deploying on cluster
// loadFromDefault when locally connecting to cluster
if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
  kc.loadFromCluster()
} else {
  kc.loadFromDefault()
}

// Callbacks
const secretsAndConfigmapsCallback = async (e: any) => {
  const { object } = e
  const { metadata, data } = object

  if (object.kind === 'Secret' && metadata.name === 'apl-gitea-operator-secret') {
    env.giteaPassword = Buffer.from(data.giteaPassword, 'base64').toString()
    env.oidcClientId = Buffer.from(data.oidcClientId, 'base64').toString()
    env.oidcClientSecret = Buffer.from(data.oidcClientSecret, 'base64').toString()
    env.oidcEndpoint = Buffer.from(data.oidcEndpoint, 'base64').toString()
  } else if (object.kind === 'ConfigMap' && metadata.name === 'apl-gitea-operator-cm') {
    env.hasArgocd = data.hasArgocd === 'true'
    env.teamConfig = JSON.parse(data.teamConfig)
    env.teamNames = keys(env.teamConfig).filter((teamName) => teamName !== 'admin')
    env.domainSuffix = data.domainSuffix
  }

  if (!env.giteaPassword || !env.teamConfig || !env.oidcClientId || !env.oidcClientSecret || !env.oidcEndpoint) {
    console.info('Missing required variables for Gitea setup/reconfiguration')
    return
  }

  switch (e.type) {
    case ResourceEventType.Added:
    case ResourceEventType.Modified: {
      try {
        await runSetupGitea()
      } catch (error) {
        const errorMessage = getSanitizedErrorMessage(error)
        console.debug('Error could not run setup gitea', errorMessage)
      }
      break
    }
    default:
      break
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
async function triggerTemplateCallback(resourceEvent: ResourceEvent): Promise<void> {
  const { object } = resourceEvent
  const { metadata } = object
  if (!metadata?.namespace?.includes('team-')) return
  if (object.kind === 'TriggerTemplate') {
    const formattedGiteaUrl: string = GITEA_ENDPOINT.endsWith('/') ? GITEA_ENDPOINT.slice(0, -1) : GITEA_ENDPOINT
    const { giteaPassword } = env
    retry(
      async () => {
        if (isEmpty(giteaPassword)) throw new Error('Setup missing details')
        const apiConfig = new Configuration({
          basePath: `${formattedGiteaUrl}/api/v1`,
          username: giteaEnv.GITEA_USERNAME,
          password: giteaPassword,
        })
        const repoApi = new RepositoryApi(apiConfig)

        // Collect all data to create or edit a webhook
        const resourceTemplate = (object as PipelineKubernetesObject).spec.resourcetemplates.find(
          (template) => template.kind === 'PipelineRun',
        )!
        const pipelineName = resourceTemplate.spec.pipelineRef.name
        const pipeline = await getTektonPipeline(pipelineName, metadata.namespace!)
        const task = pipeline?.spec.tasks.find((singleTask: { name: string }) => singleTask.name === 'fetch-source')
        const buildName = metadata.name!.replace('trigger-template-', '')
        const param = task?.params.find((singleParam) => {
          return singleParam.name === 'url'
        })

        const buildWebHookDetails: { buildName: string; repoUrl: string } = { buildName, repoUrl: param!.value }

        if (buildWebHookDetails.repoUrl.includes('.git'))
          buildWebHookDetails.repoUrl = buildWebHookDetails.repoUrl.replace('.git', '')
        // Logic to watch services in teamNamespaces which contain el-gitea-webhook in the name
        try {
          switch (resourceEvent.type) {
            case ResourceEventType.Added:
              await createBuildWebHook(repoApi, metadata.namespace!, buildWebHookDetails)
              break
            case ResourceEventType.Modified:
              await updateBuildWebHook(repoApi, metadata.namespace!, buildWebHookDetails)
              break
            case ResourceEventType.Deleted:
              await deleteBuildWebHook(repoApi, metadata.namespace!, buildWebHookDetails)
              break
            default:
              console.debug(`Unhandled event type: ${resourceEvent.type}`)
          }
        } catch (error) {
          console.debug('Webhook operation failed:', error)
        }

        return
      },
      { retries: giteaEnv.RETRIES, minTimeout: giteaEnv.MIN_TIMEOUT },
    ).catch((error) => {
      console.error(error)
    })
  } else return
}

const createSetGiteaOIDCConfig = (() => {
  let intervalId: any = null
  return function runSetGiteaOIDCConfig() {
    if (intervalId === null) {
      intervalId = setInterval(() => {
        setGiteaOIDCConfig(env, kc)
          .catch((error) => {
            console.error('Error occurred during setGiteaOIDCConfig execution:', error)
          })
          .finally(() => {
            intervalId = null
          })
      }, giteaEnv.CHECK_OIDC_CONFIG_INTERVAL * 1000)
    }
  }
})()

// Operator
export default class MyOperator extends Operator {
  protected async init() {
    // Wait for Gitea to be available before starting resource watching
    await this.waitForGiteaAvailability()

    // Run setGiteaOIDCConfig every 30 seconds
    createSetGiteaOIDCConfig()
    // Watch apl-gitea-operator-secrets
    try {
      await this.watchResource('', 'v1', 'secrets', secretsAndConfigmapsCallback, giteaEnv.GITEA_OPERATOR_NAMESPACE)
    } catch (error) {
      const errorMessage = getSanitizedErrorMessage(error)
      console.debug('Error could not watch secrets', errorMessage)
    }
    // Watch apl-gitea-operator-cm
    try {
      await this.watchResource('', 'v1', 'configmaps', secretsAndConfigmapsCallback, giteaEnv.GITEA_OPERATOR_NAMESPACE)
    } catch (error) {
      const errorMessage = getSanitizedErrorMessage(error)
      console.debug('Error could not watch configmaps', errorMessage)
    }
    // Watch team namespace services that contain 'el-gitea-webhook' in the name
    try {
      await this.watchResource('triggers.tekton.dev', 'v1beta1', 'triggertemplates', triggerTemplateCallback)
    } catch (error) {
      const errorMessage = getSanitizedErrorMessage(error)
      console.debug('Error could not watch tekton triggers', errorMessage)
    }
  }

  private async waitForGiteaAvailability(): Promise<void> {
    console.info('Waiting for Gitea to be available...')

    const formattedGiteaUrl: string = GITEA_ENDPOINT.endsWith('/') ? GITEA_ENDPOINT.slice(0, -1) : GITEA_ENDPOINT

    await retry(
      async () => {
        try {
          // Use the Gitea client library to check if the API is available
          const miscApi = new MiscellaneousApi(new Configuration({ basePath: `${formattedGiteaUrl}/api/v1` }))
          const versionResult = await miscApi.getVersion()
          console.info(`Gitea API is available, version: ${versionResult.version}`)
        } catch (error) {
          const errorMessage = getSanitizedErrorMessage(error)
          console.debug(`Gitea not ready yet: ${errorMessage}`)
          throw error
        }
      },
      {
        retries: 30,
        minTimeout: 10000,
        maxTimeout: 10000,
        onRetry: (error, attempt) => {
          console.debug(`Gitea availability check failed (attempt ${attempt}/30), retrying...`)
        },
      },
    )
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()
  console.info(`Listening to secrets, configmaps and namespaces`)
  await operator.start()
  const exit = (reason: string) => {
    operator.stop()
    process.exit(0)
  }

  process.on('SIGTERM', () => exit('SIGTERM')).on('SIGINT', () => exit('SIGINT'))
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}

// Runners
async function checkAndExecute() {
  const currentState: DependencyState = {
    giteaPassword: env.giteaPassword,
    teamConfig: env.teamConfig,
    oidcClientId: env.oidcClientId,
    oidcClientSecret: env.oidcClientSecret,
    oidcEndpoint: env.oidcEndpoint,
    teamNames: env.teamNames,
  }

  // Check and execute setupGitea if dependencies changed
  if (
    !currentState.giteaPassword ||
    !currentState.teamConfig ||
    currentState.giteaPassword !== lastState.giteaPassword ||
    currentState.teamConfig !== lastState.teamConfig
  ) {
    await setupGitea()
  }

  // Check and execute setGiteaOIDCConfig if dependencies changed
  if (
    !currentState.oidcClientId ||
    !currentState.oidcClientSecret ||
    !currentState.oidcEndpoint ||
    !currentState.teamNames ||
    currentState.oidcClientId !== lastState.oidcClientId ||
    currentState.oidcClientSecret !== lastState.oidcClientSecret ||
    currentState.oidcEndpoint !== lastState.oidcEndpoint ||
    currentState.teamNames !== lastState.teamNames
  ) {
    await setGiteaOIDCConfig(env, kc, true)
  }

  // Update last known state
  lastState = currentState
}

async function runSetupGitea() {
  try {
    await checkAndExecute()
  } catch (error) {
    const sanitizedMsg = getSanitizedErrorMessage(error)
    console.debug('Error could not run setup gitea', sanitizedMsg)
    console.debug('Retrying in 30 seconds')
    await new Promise((resolve) => setTimeout(resolve, 30000))
    console.debug('Retrying to setup gitea')
    await runSetupGitea()
  }
}

async function setupGitea() {
  const formattedGiteaUrl: string = GITEA_ENDPOINT.endsWith('/') ? GITEA_ENDPOINT.slice(0, -1) : GITEA_ENDPOINT
  const { giteaPassword, teamConfig, hasArgocd } = env
  console.info('Starting Gitea setup/reconfiguration')
  const apiConfig = new Configuration({
    basePath: `${formattedGiteaUrl}/api/v1`,
    username: giteaEnv.GITEA_USERNAME,
    password: giteaPassword,
  })
  const adminApi = new AdminApi(apiConfig)
  const teamIds = Object.keys(teamConfig)
  const orgNames = [orgName, ...teamIds]
  const orgApi = new OrganizationApi(apiConfig)
  const repoApi = new RepositoryApi(apiConfig)
  let existingOrganizations: Organization[]
  try {
    console.info('Getting all organizations')
    existingOrganizations = await orgApi.orgGetAll()
  } catch (e) {
    errors.push(`Error getting all organizations: ${e}`)
    return
  }
  existingOrganizations = await createOrganizations(orgApi, existingOrganizations, orgNames)
  await createTeams(teamIds, orgApi)
  await createUsers(adminApi, existingOrganizations, orgApi, env.domainSuffix)
  let existingRepos: Repository[]
  try {
    console.info(`Getting all repos in organization "${orgName}"`)
    existingRepos = await orgApi.orgListRepos({ org: orgName })
  } catch (e) {
    errors.push(`Error getting all repos in organization "${orgName}": ${e}`)
    return
  }
  const repoOption: CreateRepoOption = {
    autoInit: false,
    name: otomiValuesRepoName,
    _private: true,
  }
  await createReposAndAddToTeam(orgApi, repoApi, existingRepos, repoOption)

  // check for specific hooks
  await addTektonHook(repoApi)

  if (!hasArgocd) return

  // then create initial gitops repo for teams
  await Promise.all(
    teamIds.map(async (teamId) => {
      const name = `team-${teamId}-argocd`
      const option = { ...repoOption, autoInit: true, name }
      return upsertRepo(existingRepos, orgApi, repoApi, option, `team-${teamId}`)
    }),
  )
  if (errors.length) {
    console.error(`Errors found: ${JSON.stringify(errors, null, 2)}`)
    process.exit(1)
  } else {
    console.info('Success! Gitea setup/reconfiguration completed')
  }
}
