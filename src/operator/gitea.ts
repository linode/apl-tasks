import * as k8s from '@kubernetes/client-node'
import stream from 'stream'

import Operator, { ResourceEventType } from '@linode/apl-k8s-operator'
import {
  AdminApi,
  CreateHookOption,
  CreateOrgOption,
  CreateRepoOption,
  CreateTeamOption,
  CreateUserOption,
  EditRepoOption,
  EditUserOption,
  HttpError,
  Organization,
  OrganizationApi,
  Repository,
  RepositoryApi,
  Team,
  User,
} from '@linode/gitea-client-node'
import { generate as generatePassword } from 'generate-password'
import { isEmpty, keys } from 'lodash'
import { setServiceAccountSecret } from '../gitea-utils'
import { doApiCall } from '../utils'
import {
  CHECK_OIDC_CONFIG_INTERVAL,
  GITEA_OPERATOR_NAMESPACE,
  GITEA_URL,
  GITEA_URL_PORT,
  cleanEnv,
} from '../validators'
import { orgName, otomiChartsRepoName, otomiValuesRepoName, teamNameOwners, teamNameViewer, username } from './common'

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

// Constants
const localEnv = cleanEnv({
  GITEA_URL,
  GITEA_URL_PORT,
  GITEA_OPERATOR_NAMESPACE,
  CHECK_OIDC_CONFIG_INTERVAL,
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

const kc = new k8s.KubeConfig()
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
  } else return

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
        console.debug(error)
      }
      break
    }
    default:
      break
  }
}
// Exported for testing purposes
export const addServiceAccountToOrganizations = async (
  organizationApi: OrganizationApi,
  serviceAcountName: string,
  organisations: Organization[],
) => {
  const organisation = organisations.find((org) => serviceAcountName === `organization-${org.name}`)
  const teams: Team[] = await doApiCall(errors, `Getting teams from organization: ${organisation?.name}`, () =>
    organizationApi.orgListTeams(organisation!.name!),
  )
  const ownerTeam = teams.find((team) => team.name === 'Owners')
  const members: User[] = await doApiCall(errors, `Getting members from Owners team in ${organisation?.name}`, () =>
    organizationApi.orgListTeamMembers(ownerTeam!.id!),
  )
  if (isEmpty(members)) return
  const exists = members.some((member) => member.login === serviceAcountName)
  if (exists) return
  await doApiCall(errors, `Adding user to organization Owners team in ${organisation?.name}`, () =>
    organizationApi.orgAddTeamMember(ownerTeam!.id!, serviceAcountName),
  )
}

// Exported for testing purposes
export const editServiceAccount = async (adminApi: AdminApi, loginName: string, password: string) => {
  const editUserOption = {
    ...new EditUserOption(),
    loginName,
    password,
  }
  await doApiCall(errors, `Editing user: ${loginName} with new password`, () =>
    adminApi.adminEditUser(loginName, editUserOption),
  )
}

// Exported for testing purposes
export const createServiceAccounts = async (
  adminApi: AdminApi,
  organizations: Organization[],
  orgApi: OrganizationApi,
) => {
  const users: User[] = await doApiCall(errors, `Getting all users`, () => adminApi.adminGetAllUsers())
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
        await doApiCall(errors, `Creating user: ${serviceAccount}`, () => adminApi.adminCreateUser(createUserOption))
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
    // Run setGiteaOIDCConfig every 30 seconds
    createSetGiteaOIDCConfig()
    // Watch apl-gitea-operator-secrets
    try {
      await this.watchResource('', 'v1', 'secrets', secretsAndConfigmapsCallback, localEnv.GITEA_OPERATOR_NAMESPACE)
    } catch (error) {
      console.debug(error)
    }
    // Watch apl-gitea-operator-cm
    try {
      await this.watchResource('', 'v1', 'configmaps', secretsAndConfigmapsCallback, localEnv.GITEA_OPERATOR_NAMESPACE)
    } catch (error) {
      console.debug(error)
    }
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
    console.debug('Error could not run setup gitea', error)
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
  if (isEmpty(existingOrg))
    return doApiCall(errors, `Creating org "${orgOption.fullName}"`, () => orgApi.orgCreate(orgOption), 422)

  return doApiCall(
    errors,
    `Updating org "${orgOption.fullName}"`,
    () => orgApi.orgEdit(prefixedOrgName, orgOption),
    422,
  )
}

// Setup Gitea Functions
async function upsertTeam(
  orgApi: OrganizationApi,
  organizationName: string,
  teamOption: CreateTeamOption,
): Promise<void> {
  const getErrors: string[] = []
  const existingTeams: Team[] = await doApiCall(getErrors, `Getting all teams in org "${organizationName}"`, () =>
    orgApi.orgListTeams(organizationName),
  )
  if (!isEmpty(getErrors)) console.error('Errors when gettings teams.', getErrors)
  const existingTeam = existingTeams?.find((team) => team.name === teamOption.name)
  if (existingTeam === undefined) {
    return doApiCall(
      errors,
      `Creating team "${teamOption.name}" in org "${organizationName}"`,
      () => orgApi.orgCreateTeam(organizationName, teamOption),
      422,
    )
  } else {
    return doApiCall(
      errors,
      `Updating team "${teamOption.name}" in org "${organizationName}"`,
      () => orgApi.orgEditTeam(existingTeam.id!, teamOption),
      422,
    )
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
    // org repo create
    console.info(`Creating repo "${repoName}" in org "${orgName}"`)
    await orgApi.createOrgRepo(orgName, repoOption as CreateRepoOption)
    addTeam = true
  } else {
    // repo update
    console.info(`Updating repo "${repoName}" in org "${orgName}"`)
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
  // create org wide viewer team for otomi role "team-viewer"
  await upsertTeam(orgApi, orgName, readOnlyTeam)
  return existingOrganizations
}

async function hasSpecificHook(repoApi: RepositoryApi, hookToFind: string): Promise<hookInfo> {
  const hooks: any[] = await doApiCall(
    errors,
    `Getting hooks in repo "otomi/values"`,
    () => repoApi.repoListHooks(orgName, 'values'),
    400,
  )
  if (!hooks) {
    console.debug(`No hooks were found in repo "values"`)
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
    await doApiCall(
      errors,
      `Adding hook "tekton" to repo otomi/values`,
      () =>
        repoApi.repoCreateHook(orgName, 'values', {
          type: CreateHookOption.TypeEnum.Gitea,
          active: true,
          config: {
            url: clusterIP,
            http_method: 'post',
            content_type: 'json',
          },
          events: ['push'],
        } as CreateHookOption),
      304,
    )
  }
}

async function createReposAndAddToTeam(
  orgApi: OrganizationApi,
  repoApi: RepositoryApi,
  existingRepos: Repository[],
  repoOption: CreateRepoOption,
) {
  // create main org repo: otomi/values
  await upsertRepo(existingRepos, orgApi, repoApi, repoOption)
  // create otomi/charts repo for auto image updates
  await upsertRepo(existingRepos, orgApi, repoApi, { ...repoOption, name: otomiChartsRepoName })

  // add repo: otomi/values to the team: otomi-viewer
  const existingValuesRepo = existingRepos.find((repo) => repo.name === otomiValuesRepoName)
  const existingChartsRepo = existingRepos.find((repo) => repo.name === otomiChartsRepoName)
  if (!existingValuesRepo)
    await doApiCall(
      errors,
      `Adding repo ${otomiValuesRepoName} to team ${teamNameViewer}`,
      () => repoApi.repoAddTeam(orgName, otomiValuesRepoName, teamNameViewer),
      422,
    )
  if (!existingChartsRepo)
    // add repo: otomi/charts to the team: otomi-viewer
    await doApiCall(
      errors,
      `Adding repo ${otomiChartsRepoName} to team ${teamNameViewer}`,
      () => repoApi.repoAddTeam(orgName, otomiChartsRepoName, teamNameViewer),
      422,
    )
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
  let existingOrganizations = await doApiCall(errors, 'Getting all organizations', () => orgApi.orgGetAll())
  existingOrganizations = await createOrgsAndTeams(orgApi, existingOrganizations, orgNames, teamIds)
  await createServiceAccounts(adminApi, existingOrganizations, orgApi)
  const existingRepos: Repository[] = await doApiCall(errors, `Getting all repos in org "${orgName}"`, () =>
    orgApi.orgListRepos(orgName),
  )
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

async function setGiteaOIDCConfig(update = false) {
  if (!env.oidcClientId || !env.oidcClientSecret || !env.oidcEndpoint) return
  const podNamespace = 'gitea'
  const podName = 'gitea-0'
  const clientID = env.oidcClientId
  const clientSecret = env.oidcClientSecret
  const discoveryURL = `${env.oidcEndpoint}/.well-known/openid-configuration`
  const teamNamespaceString = buildTeamString(env.teamNames)
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
    const exec = new k8s.Exec(kc)
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
        (status: k8s.V1Status) => {
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
