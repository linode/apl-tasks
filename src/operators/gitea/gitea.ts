/* eslint-disable no-console */
import { CoreV1Api, Exec, KubeConfig, KubernetesObject, V1Status } from '@kubernetes/client-node'
import Operator, { ResourceEvent, ResourceEventType } from '@linode/apl-k8s-operator'
import {
  AdminApi,
  CreateHookOption,
  CreateOrgOption,
  CreateRepoOption,
  CreateTeamOption,
  CreateUserOption,
  EditHookOption,
  EditRepoOption,
  EditUserOption,
  HttpError,
  MiscellaneousApi,
  Organization,
  OrganizationApi,
  Repository,
  RepositoryApi,
  Team,
  User,
} from '@linode/gitea-client-node'
import retry from 'async-retry'
import { generate as generatePassword } from 'generate-password'
import { isEmpty, keys } from 'lodash'
import stream from 'stream'
import { getRepoNameFromUrl, setServiceAccountSecret } from '../../gitea-utils'
import { getTektonPipeline } from '../../k8s'
import { getSanitizedErrorMessage } from '../../utils'
import {
  CHECK_OIDC_CONFIG_INTERVAL,
  cleanEnv,
  GITEA_OPERATOR_NAMESPACE,
  GITEA_URL,
  GITEA_URL_PORT,
  MIN_TIMEOUT,
  RETRIES,
} from '../../validators'
import { orgName, otomiChartsRepoName, otomiValuesRepoName, teamNameOwners, teamNameViewer, username } from '../common'

// Interfaces
interface hookInfo {
  id?: number
  hasHook: boolean
}

interface groupMapping {
  [key: string]: {
    [teamId: string]: string[]
  }
}

interface DependencyState {
  giteaPassword: string | null
  teamConfig: any
  oidcClientId: string | null
  oidcClientSecret: string | null
  oidcEndpoint: string | null
  teamNames: string[] | null
}
interface Param {
  name: string
  value: string
}
interface Task {
  name: string
  params: Param[]
}

interface PipelineTemplateObject extends KubernetesObject {
  spec: {
    pipelineRef: {
      name: string
    }
  }
}

export interface PipelineKubernetesObject extends KubernetesObject {
  spec: {
    tasks: Task[]
    resourcetemplates: PipelineTemplateObject[]
  }
}

// Constants
const localEnv = cleanEnv({
  GITEA_URL,
  GITEA_URL_PORT,
  GITEA_OPERATOR_NAMESPACE,
  CHECK_OIDC_CONFIG_INTERVAL,
  RETRIES,
  MIN_TIMEOUT,
})

const GITEA_ENDPOINT = `${localEnv.GITEA_URL}:${localEnv.GITEA_URL_PORT}`
const env = {
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
const errors: string[] = []

const readOnlyTeam: CreateTeamOption = {
  ...new CreateTeamOption(),
  canCreateOrgRepo: false,
  name: teamNameViewer,
  includesAllRepositories: false,
  permission: CreateTeamOption.PermissionEnum.Read,
  units: ['repo.code'],
}

const editorTeam: CreateTeamOption = {
  ...readOnlyTeam,
  includesAllRepositories: false,
  permission: CreateTeamOption.PermissionEnum.Write,
}

const adminTeam: CreateTeamOption = { ...editorTeam, permission: CreateTeamOption.PermissionEnum.Admin }

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
        const repoApi = new RepositoryApi(username, giteaPassword, `${formattedGiteaUrl}/api/v1`)

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
      { retries: localEnv.RETRIES, minTimeout: localEnv.MIN_TIMEOUT },
    ).catch((error) => {
      console.error(error)
    })
  } else return
}

// Exported for testing purposes
export const addServiceAccountToOrganizations = async (
  organizationApi: OrganizationApi,
  serviceAcountName: string,
  organisations: Organization[],
) => {
  const organisation = organisations.find((org) => serviceAcountName === `organization-${org.name}`)
  let teams: Team[]
  try {
    console.info(`Getting teams from organization: ${organisation?.name}`)
    teams = (await organizationApi.orgListTeams(organisation!.name!)).body
  } catch (e) {
    errors.push(`Error getting teams from organization ${organisation?.name}: ${e}`)
    return
  }
  const ownerTeam = teams.find((team) => team.name === 'Owners')
  let members: User[]
  try {
    console.info(`Getting members from Owners team in ${organisation?.name}`)
    members = (await organizationApi.orgListTeamMembers(ownerTeam!.id!)).body
  } catch (e) {
    errors.push(`Error getting members from Owners team in ${organisation?.name}: ${e}`)
    return
  }
  if (isEmpty(members)) return
  const exists = members.some((member) => member.login === serviceAcountName)
  if (exists) return
  try {
    console.info(`Adding user to organization Owners team in ${organisation?.name}`)
    await organizationApi.orgAddTeamMember(ownerTeam!.id!, serviceAcountName)
  } catch (e) {
    errors.push(`Error adding user to organization Owners team in ${organisation?.name}: ${e}`)
  }
}

// Exported for testing purposes
export const editServiceAccount = async (adminApi: AdminApi, loginName: string, password: string) => {
  const editUserOption = {
    ...new EditUserOption(),
    loginName,
    password,
  }
  try {
    console.info(`Editing user: ${loginName} with new password`)
    await adminApi.adminEditUser(loginName, editUserOption)
  } catch (e) {
    errors.push(`Error editing user ${loginName}: ${e}`)
  }
}

// Exported for testing purposes
export const createServiceAccounts = async (
  adminApi: AdminApi,
  organizations: Organization[],
  orgApi: OrganizationApi,
) => {
  let users: User[]
  try {
    console.info('Getting all users')
    users = (await adminApi.adminSearchUsers()).body
  } catch (e) {
    errors.push(`Error getting all users: ${e}`)
    return
  }
  const filteredOrganizations = organizations.filter((org) => org.name !== 'otomi')
  await Promise.all(
    filteredOrganizations.map(async (organization) => {
      const serviceAccountSecretName = 'gitea-credentials'
      const exists = users.some((user) => user.login === `organization-${organization.name}`)
      const password = generatePassword({
        length: 16,
        numbers: true,
        symbols: true,
        lowercase: true,
        uppercase: true,
        exclude: String(':,;"/=|%\\\''),
      })
      const giteaURL = `https://gitea.${env.domainSuffix}`
      const serviceAccount = `organization-${organization.name}`

      if (!exists) {
        const organizationEmail = `${organization.name}@mail.com`
        const createUserOption = {
          ...new CreateUserOption(),
          email: organizationEmail,
          password,
          username: serviceAccount,
          loginName: serviceAccount,
          fullName: serviceAccount,
          restricted: false,
          mustChangePassword: false,
          repoAdminChangeTeamAccess: true,
        }
        try {
          console.info(`Creating user: ${serviceAccount}`)
          await adminApi.adminCreateUser(createUserOption)
        } catch (e) {
          errors.push(`Error creating user ${serviceAccount}: ${e}`)
        }
      } else {
        await editServiceAccount(adminApi, serviceAccount, password)
      }

      await setServiceAccountSecret(serviceAccountSecretName, serviceAccount, organization.name!, password, giteaURL)
      await addServiceAccountToOrganizations(orgApi, serviceAccount, filteredOrganizations)
    }),
  )
}

const createSetGiteaOIDCConfig = (() => {
  let intervalId: any = null
  return function runSetGiteaOIDCConfig() {
    if (intervalId === null) {
      intervalId = setInterval(() => {
        setGiteaOIDCConfig()
          .catch((error) => {
            console.error('Error occurred during setGiteaOIDCConfig execution:', error)
          })
          .finally(() => {
            intervalId = null
          })
      }, localEnv.CHECK_OIDC_CONFIG_INTERVAL * 1000)
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
      await this.watchResource('', 'v1', 'secrets', secretsAndConfigmapsCallback, localEnv.GITEA_OPERATOR_NAMESPACE)
    } catch (error) {
      const errorMessage = getSanitizedErrorMessage(error)
      console.debug('Error could not watch secrets', errorMessage)
    }
    // Watch apl-gitea-operator-cm
    try {
      await this.watchResource('', 'v1', 'configmaps', secretsAndConfigmapsCallback, localEnv.GITEA_OPERATOR_NAMESPACE)
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
          const miscApi = new MiscellaneousApi(`${formattedGiteaUrl}/api/v1`)
          const versionResult = await miscApi.getVersion()
          console.info(`Gitea API is available, version: ${versionResult.body.version}`)
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
    await setGiteaOIDCConfig(true)
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

// Exported for testing purposes
export async function upsertOrganization(
  orgApi: OrganizationApi,
  existingOrganizations: Organization[],
  organizationName: string,
): Promise<Organization> {
  const prefixedOrgName = !organizationName.includes('otomi') ? `team-${organizationName}` : organizationName
  const orgOption = {
    ...new CreateOrgOption(),
    username: prefixedOrgName,
    fullName: prefixedOrgName,
    repoAdminChangeTeamAccess: true,
  }
  const existingOrg = existingOrganizations.find((organization) => organization.name === prefixedOrgName)
  if (isEmpty(existingOrg)) {
    try {
      console.info(`Creating organization "${orgOption.fullName}"`)
      const { body } = await orgApi.orgCreate(orgOption)
      return body
    } catch (e) {
      if (e.statusCode !== 422) {
        errors.push(`Error creating organization "${orgOption.fullName}": ${e}`)
      }
      throw e
    }
  }

  try {
    console.info(`Updating organization "${orgOption.fullName}"`)
    const { body } = await orgApi.orgEdit(prefixedOrgName, orgOption)
    return body
  } catch (e) {
    if (e.statusCode !== 422) {
      errors.push(`Error updating organization "${orgOption.fullName}": ${e}`)
    }
    throw e
  }
}

// Setup Gitea Functions
async function upsertTeam(
  orgApi: OrganizationApi,
  organizationName: string,
  teamOption: CreateTeamOption,
): Promise<void> {
  const getErrors: string[] = []
  let existingTeams: Team[]
  try {
    console.info(`Getting all teams in orginazation "${organizationName}"`)
    existingTeams = (await orgApi.orgListTeams(organizationName)).body
  } catch (e) {
    getErrors.push(`Error getting all teams in organization "${organizationName}": ${e}`)
    console.error('Errors when getting teams.', getErrors)
    return
  }
  const existingTeam = existingTeams?.find((team) => team.name === teamOption.name)
  if (existingTeam === undefined) {
    try {
      console.info(`Creating team "${teamOption.name}" in organization "${organizationName}"`)
      await orgApi.orgCreateTeam(organizationName, teamOption)
    } catch (e) {
      if (e.statusCode !== 422) {
        errors.push(`Error creating team "${teamOption.name}" in organization "${organizationName}": ${e}`)
      }
    }
  } else {
    try {
      console.info(`Updating team "${teamOption.name}" in organization "${organizationName}"`)
      await orgApi.orgEditTeam(existingTeam.id!, teamOption)
    } catch (e) {
      if (e.statusCode !== 422) {
        errors.push(`Error updating team "${teamOption.name}" in organization "${organizationName}": ${e}`)
      }
    }
  }
}

async function upsertRepo(
  existingReposInOrg: Repository[] = [],
  orgApi: OrganizationApi,
  repoApi: RepositoryApi,
  repoOption: CreateRepoOption | EditRepoOption,
  teamName?: string,
): Promise<void> {
  const repoName = repoOption.name!
  const existingRepo = existingReposInOrg.find((repository) => repository.name === repoName)
  let addTeam = false
  if (isEmpty(existingRepo)) {
    // organization repo create
    console.info(`Creating repo "${repoName}" in organization "${orgName}"`)
    await orgApi.createOrgRepo(orgName, repoOption as CreateRepoOption)
    addTeam = true
  } else {
    // repo update
    console.info(`Updating repo "${repoName}" in organization "${orgName}"`)
    await repoApi.repoEdit(orgName, repoName, repoOption as EditRepoOption)
    if (teamName) {
      console.info(`Checking if repo "${repoName}" is assigned to team "${teamName}"`)
      try {
        await repoApi.repoCheckTeam(orgName, repoName, teamName)
      } catch (error) {
        if (error instanceof HttpError && error.statusCode === 404) {
          addTeam = true
        } else {
          throw error
        }
      }
    }
  }
  if (addTeam && teamName) {
    console.info(`Adding repo "${repoName}" to team "${teamName}"`)
    await repoApi.repoAddTeam(orgName, repoName, teamName)
  }
}

async function createOrgsAndTeams(
  orgApi: OrganizationApi,
  existingOrganizations: Organization[],
  organizationNames: string[],
  teamIds: string[],
): Promise<Organization[]> {
  await Promise.all(
    organizationNames.map(async (organizationName) => {
      const organization = await upsertOrganization(orgApi, existingOrganizations, organizationName)
      if (existingOrganizations.find((org) => org.id === organization.id)) return
      existingOrganizations.push(organization)
    }),
  )
  await Promise.all(
    teamIds.map((teamId) => {
      const name = `team-${teamId}`
      return upsertTeam(orgApi, orgName, { ...adminTeam, name })
    }),
  )
  // create organization wide viewer team for otomi role "team-viewer"
  await upsertTeam(orgApi, orgName, readOnlyTeam)
  return existingOrganizations
}

async function hasSpecificHook(repoApi: RepositoryApi, hookToFind: string): Promise<hookInfo> {
  let hooks: any[]
  try {
    console.debug(`Getting hooks in repo "otomi/values"`)
    hooks = (await repoApi.repoListHooks(orgName, 'values')).body
  } catch (e) {
    if (e.statusCode !== 400) {
      errors.push(`Error getting hooks in repo "otomi/values": ${e}`)
    }
    console.debug(`No hooks were found in repo "otomi/values"`)
    return { hasHook: false }
  }
  if (!hooks) {
    console.debug(`No hooks were found in repo "otomi/values"`)
    return { hasHook: false }
  }

  const foundHook = hooks.find((hook) => {
    return hook.config && hook.config.url.includes(hookToFind)
  })
  if (foundHook) {
    console.debug(`Hook (${hookToFind}) exists in repo "values"`)
    return { id: foundHook.id, hasHook: true }
  }
  console.debug(`Hook (${hookToFind}) not found in repo "values"`)
  return { hasHook: false }
}

async function addTektonHook(repoApi: RepositoryApi): Promise<void> {
  console.debug('Check for Tekton hook')
  const clusterIP = 'http://el-otomi-tekton-listener.otomi-pipelines.svc.cluster.local:8080'
  const hasTektonHook = await hasSpecificHook(repoApi, 'el-otomi-tekton-listener')
  if (!hasTektonHook.hasHook) {
    console.debug('Tekton Hook needs to be created')
    try {
      console.debug(`Adding hook "tekton" to repo otomi/values`)
      await repoApi.repoCreateHook(orgName, 'values', {
        type: CreateHookOption.TypeEnum.Gitea,
        active: true,
        config: {
          url: clusterIP,
          http_method: 'post',
          content_type: 'json',
        },
        events: ['push'],
      } as CreateHookOption)
    } catch (e) {
      if (e.statusCode !== 304) {
        errors.push(`Error adding hook "tekton" to repo otomi/values: ${e}`)
      }
    }
  }
}

async function createReposAndAddToTeam(
  orgApi: OrganizationApi,
  repoApi: RepositoryApi,
  existingRepos: Repository[],
  repoOption: CreateRepoOption,
) {
  // create main organization repo: otomi/values
  await upsertRepo(existingRepos, orgApi, repoApi, repoOption)
  // create otomi/charts repo for auto image updates
  await upsertRepo(existingRepos, orgApi, repoApi, { ...repoOption, name: otomiChartsRepoName })

  // add repo: otomi/values to the team: otomi-viewer
  const existingValuesRepo = existingRepos.find((repo) => repo.name === otomiValuesRepoName)
  const existingChartsRepo = existingRepos.find((repo) => repo.name === otomiChartsRepoName)
  if (!existingValuesRepo) {
    try {
      console.info(`Adding repo "${otomiValuesRepoName}" to team "${teamNameViewer}"`)
      await repoApi.repoAddTeam(orgName, otomiValuesRepoName, teamNameViewer)
    } catch (e) {
      if (e.statusCode !== 422) {
        errors.push(`Error adding repo ${otomiValuesRepoName} to team ${teamNameViewer}: ${e}`)
      }
    }
  }
  if (!existingChartsRepo) {
    // add repo: otomi/charts to the team: otomi-viewer
    try {
      console.info(`Adding repo "${otomiChartsRepoName}" to team "${teamNameViewer}"`)
      await repoApi.repoAddTeam(orgName, otomiChartsRepoName, teamNameViewer)
    } catch (e) {
      if (e.statusCode !== 422) {
        errors.push(`Error adding repo ${otomiChartsRepoName} to team ${teamNameViewer}: ${e}`)
      }
    }
  }
}

// Logic to create a webhook for repos in an organization
export async function createBuildWebHook(
  repoApi: RepositoryApi,
  teamName: string,
  buildWorkspace: { buildName: string; repoUrl: string },
) {
  try {
    const repoName = getRepoNameFromUrl(buildWorkspace.repoUrl)!

    // Check to see if a webhook already exists with the same url and push event
    const webhooks = (await repoApi.repoListHooks(teamName, repoName)).body
    let webhookExists
    if (!isEmpty(webhooks)) {
      webhookExists = webhooks.find((hook) => {
        return (
          hook.config!.url ===
            `http://el-gitea-webhook-${buildWorkspace.buildName}.${teamName}.svc.cluster.local:8080` &&
          hook.events?.includes('push')
        )
      })
    }

    if (!isEmpty(webhookExists)) return
    const createHookOption: CreateHookOption = {
      ...new CreateHookOption(),
      active: true,
      type: CreateHookOption.TypeEnum.Gitea,
      events: ['push'],
      config: {
        content_type: 'json',
        url: `http://el-gitea-webhook-${buildWorkspace.buildName}.${teamName}.svc.cluster.local:8080`,
      },
    }
    await repoApi.repoCreateHook(teamName, repoName, createHookOption)
    console.info(`Gitea webhook created for repository: ${repoName} in ${teamName}`)
  } catch (error) {
    throw new Error(`Error creating Gitea webhook`)
  }
}

// Logic to update a webhook for repos in an organization
export async function updateBuildWebHook(
  repoApi: RepositoryApi,
  teamName: string,
  buildWorkspace: { buildName: string; repoUrl: string },
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const repoName = getRepoNameFromUrl(buildWorkspace.repoUrl)!
    const webhooks = (await repoApi.repoListHooks(teamName, repoName)).body

    if (isEmpty(webhooks)) {
      console.debug(`No webhooks found for ${repoName} in ${teamName}`)
      console.debug('Trying to create one instead...')
      return await createBuildWebHook(repoApi, teamName, buildWorkspace)
    }

    const editHookOption: EditHookOption = {
      ...new EditHookOption(),
      active: true,
      events: ['push'],
      config: {
        content_type: 'json',
        url: `http://el-gitea-webhook-${buildWorkspace.buildName}.${teamName}.svc.cluster.local:8080`,
      },
    }
    await Promise.all(
      webhooks.map(async (webhook) => {
        await repoApi.repoEditHook(teamName, repoName, webhook.id!, editHookOption)
      }),
    )
    console.info(`Gitea webhook updated for repository: ${repoName} in ${teamName}`)
  } catch (error) {
    throw new Error('Error updating Gitea webhook')
  }
}

// Logic to delete a webhook for repos in a organization
export async function deleteBuildWebHook(
  repoApi: RepositoryApi,
  teamName: string,
  buildWorkspace: { buildName: string; repoUrl: string },
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const repoName = buildWorkspace.repoUrl.split('/').pop()!
    const webhooks = (await repoApi.repoListHooks(teamName, repoName)).body

    if (isEmpty(webhooks)) throw new Error(`No webhooks found for ${repoName} in ${teamName}`)

    await Promise.all(
      webhooks.map(async (webhook) => {
        await repoApi.repoDeleteHook(teamName, repoName, webhook.id!)
      }),
    )
    console.info(`Gitea webhook deleted for repository: ${repoName} in ${teamName}`)
  } catch (error) {
    throw new Error('Error deleting Gitea webhook')
  }
}

async function setupGitea() {
  const formattedGiteaUrl: string = GITEA_ENDPOINT.endsWith('/') ? GITEA_ENDPOINT.slice(0, -1) : GITEA_ENDPOINT
  const { giteaPassword, teamConfig, hasArgocd } = env
  console.info('Starting Gitea setup/reconfiguration')
  const adminApi = new AdminApi(username, giteaPassword, `${formattedGiteaUrl}/api/v1`)
  const teamIds = Object.keys(teamConfig)
  const orgNames = [orgName, ...teamIds]
  const orgApi = new OrganizationApi(username, giteaPassword, `${formattedGiteaUrl}/api/v1`)
  const repoApi = new RepositoryApi(username, giteaPassword, `${formattedGiteaUrl}/api/v1`)
  let existingOrganizations: Organization[]
  try {
    console.info('Getting all organizations')
    existingOrganizations = (await orgApi.orgGetAll()).body
  } catch (e) {
    errors.push(`Error getting all organizations: ${e}`)
    return
  }
  existingOrganizations = await createOrgsAndTeams(orgApi, existingOrganizations, orgNames, teamIds)
  await createServiceAccounts(adminApi, existingOrganizations, orgApi)
  let existingRepos: Repository[]
  try {
    console.info(`Getting all repos in organization "${orgName}"`)
    existingRepos = (await orgApi.orgListRepos(orgName)).body
  } catch (e) {
    errors.push(`Error getting all repos in organization "${orgName}": ${e}`)
    return
  }
  const repoOption: CreateRepoOption = {
    ...new CreateRepoOption(),
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

// Set Gitea Functions
// Exported for testing purposes
export function buildTeamString(teamNames: any[]): string {
  const teamObject: groupMapping = { 'platform-admin': { otomi: [teamNameOwners] } }
  if (teamNames === undefined) return JSON.stringify(teamObject)
  teamNames.forEach((teamName: string) => {
    const team = `team-${teamName}`
    teamObject[team] = {
      otomi: [teamNameViewer, team],
      [team]: ['Owners'],
    }
  })
  return JSON.stringify(teamObject)
}

async function getGiteaPodName(namespace: string): Promise<string | undefined> {
  const k8sApi = kc.makeApiClient(CoreV1Api)
  const giteaPods = await k8sApi.listNamespacedPod({
    namespace,
    labelSelector: 'app.kubernetes.io/instance=gitea,app.kubernetes.io/name=gitea',
    limit: 1,
  })
  if (giteaPods.items.length === 0) {
    console.debug('Not ready for setting up OIDC config: Gitea pod not found.')
    return
  }
  return giteaPods.items[0].metadata?.name
}

async function setGiteaOIDCConfig(update = false) {
  if (!env.oidcClientId || !env.oidcClientSecret || !env.oidcEndpoint) return
  const podNamespace = 'gitea'
  const clientID = env.oidcClientId
  const clientSecret = env.oidcClientSecret
  const discoveryURL = `${env.oidcEndpoint}/.well-known/openid-configuration`
  const teamNamespaceString = buildTeamString(env.teamNames)

  const podName = await getGiteaPodName(podNamespace)
  if (!podName) {
    console.debug('Not ready for setting up OIDC config: Name of Gitea pod not found.')
    return
  }

  try {
    // WARNING: Dont enclose the teamNamespaceString in double quotes, this will escape the string incorrectly and breaks OIDC group mapping in gitea
    const execCommand = [
      'sh',
      '-c',
      `
      AUTH_ID=$(gitea admin auth list --vertical-bars | grep -E "\\|otomi-idp\\s+\\|" | grep -iE "\\|OAuth2\\s+\\|" | awk -F " " '{print $1}' | tr -d '\\n')
      if [ -z "$AUTH_ID" ]; then
        echo "Gitea OIDC config not found. Adding OIDC config for otomi-idp."
        gitea admin auth add-oauth --name "otomi-idp" --key "${clientID}" --secret "${clientSecret}" --auto-discover-url "${discoveryURL}" --provider "openidConnect" --admin-group "platform-admin" --group-claim-name "groups" --group-team-map '${teamNamespaceString}'
      elif ${update}; then
        echo "Gitea OIDC config is different. Updating OIDC config for otomi-idp."
        gitea admin auth update-oauth --id "$AUTH_ID" --key "${clientID}" --secret "${clientSecret}" --auto-discover-url "${discoveryURL}" --group-team-map '${teamNamespaceString}'
      else
        echo "Gitea OIDC config is up to date."
      fi
      `,
    ]
    const exec = new Exec(kc)
    const outputStream = new stream.PassThrough()
    let output = ''
    outputStream.on('data', (chunk) => {
      output += chunk.toString()
    })
    // Run gitea CLI command to create/update the gitea oauth configuration
    await exec
      .exec(
        podNamespace,
        podName,
        'gitea',
        execCommand,
        outputStream,
        process.stderr as stream.Writable,
        process.stdin as stream.Readable,
        false,
        (status: V1Status) => {
          console.info(output.trim())
          console.info('Gitea OIDC config status:', status.status)
        },
      )
      .catch((error) => {
        console.debug('Error occurred during exec:', error)
        throw error
      })
  } catch (error) {
    console.debug(`Error Gitea OIDC config: ${error.message}`)
    throw error
  }
}
