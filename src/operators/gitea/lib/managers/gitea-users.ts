// Exported for testing purposes
import { AdminApi, Organization, OrganizationApi, Team, User } from '@linode/gitea-client-fetch'
import { errors } from '../globals'
import { generate as generatePassword } from 'generate-password'
import { V1Secret } from '@kubernetes/client-node'
import { k8s } from '../../../../k8s'
import { isEmpty } from 'lodash'

// Exported for testing purposes
export const editUser = async (adminApi: AdminApi, loginName: string, password: string) => {
  const editUserOption = {
    sourceId: 0,
    loginName,
    password,
  }
  try {
    console.info(`Editing user: ${loginName} with new password`)
    await adminApi.adminEditUser({ username: loginName, body: editUserOption })
  } catch (e) {
    errors.push(`Error editing user ${loginName}: ${e}`)
  }
}

export async function setUserSecret(
  serviceAccountSecretName: string,
  serviceAccountLogin: string,
  teamNamespace: string,
  password: string,
  giteaUrl: string,
): Promise<string | undefined> {
  try {
    console.log(`Replacing secret for ${serviceAccountSecretName} in namespace ${teamNamespace}`)
    const updatedSecret: V1Secret = {
      metadata: {
        name: serviceAccountSecretName,
        namespace: teamNamespace,
        annotations: { 'tekton.dev/git-0': giteaUrl },
      },
      data: {
        username: Buffer.from(serviceAccountLogin).toString('base64'),
        password: Buffer.from(password).toString('base64'),
      },
      type: 'kubernetes.io/basic-auth',
    }
    await k8s
      .core()
      .replaceNamespacedSecret({ name: serviceAccountSecretName, namespace: teamNamespace, body: updatedSecret })
  } catch (error) {
    // With upgrade of kubernetes/client-node to 1.1.2, the error object is now a FetchError with code instead of statusCode
    if (error.code === 404) {
      console.log(`Secret ${serviceAccountSecretName} could not be found in namespace ${teamNamespace}!`)
      console.log(`Creating secret for ${serviceAccountSecretName} in namespace ${teamNamespace}`)
      try {
        const newSecret: V1Secret = {
          metadata: {
            name: serviceAccountSecretName,
            namespace: teamNamespace,
            annotations: { 'tekton.dev/git-0': giteaUrl },
          },
          data: {
            username: Buffer.from(serviceAccountLogin).toString('base64'),
            password: Buffer.from(password).toString('base64'),
          },
          type: 'kubernetes.io/basic-auth',
        }
        await k8s.core().createNamespacedSecret({ namespace: teamNamespace, body: newSecret })
      } catch (creatingError) {
        console.error(
          `Problem creating secret ${serviceAccountSecretName} in namespace ${teamNamespace}: ${creatingError}`,
        )
      }
    }
    console.error(`Problem replacing secret ${serviceAccountSecretName} in namespace ${teamNamespace}: ${error}`)
  }
  return password
}

// Exported for testing purposes
export const addUserToOrganization = async (
  organizationApi: OrganizationApi,
  serviceAcountName: string,
  organizations: Organization[],
) => {
  const organization = organizations.find((org) => serviceAcountName === `organization-${org.name}`)
  let teams: Team[]
  try {
    console.info(`Getting teams from organization: ${organization?.name}`)
    teams = await organizationApi.orgListTeams({ org: organization!.name! })
  } catch (e) {
    errors.push(`Error getting teams from organization ${organization?.name}: ${e}`)
    return
  }
  const ownerTeam = teams.find((team) => team.name === 'Owners')
  let members: User[]
  try {
    console.info(`Getting members from Owners team in ${organization?.name}`)
    members = await organizationApi.orgListTeamMembers({ id: ownerTeam!.id! })
  } catch (e) {
    errors.push(`Error getting members from Owners team in ${organization?.name}: ${e}`)
    return
  }
  if (isEmpty(members)) return
  const exists = members.some((member) => member.login === serviceAcountName)
  if (exists) return
  try {
    console.info(`Adding user to organization Owners team in ${organization?.name}`)
    await organizationApi.orgAddTeamMember({ id: ownerTeam!.id!, username: serviceAcountName })
  } catch (e) {
    errors.push(`Error adding user to organization Owners team in ${organization?.name}: ${e}`)
  }
}
export const createUsers = async (
  adminApi: AdminApi,
  organizations: Organization[],
  orgApi: OrganizationApi,
  domainSuffix: string,
) => {
  let users: User[]
  try {
    console.info('Getting all users')
    users = await adminApi.adminSearchUsers()
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
      const giteaURL = `https://gitea.${domainSuffix}`
      const serviceAccount = `organization-${organization.name}`

      if (!exists) {
        const organizationEmail = `${organization.name}@mail.com`
        const createUserOption = {
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
          await adminApi.adminCreateUser({ body: createUserOption })
        } catch (e) {
          errors.push(`Error creating user ${serviceAccount}: ${e}`)
        }
      } else {
        await editUser(adminApi, serviceAccount, password)
      }

      await setUserSecret(serviceAccountSecretName, serviceAccount, organization.name!, password, giteaURL)
      await addUserToOrganization(orgApi, serviceAccount, filteredOrganizations)
    }),
  )
}
