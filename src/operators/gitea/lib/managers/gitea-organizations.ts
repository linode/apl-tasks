import { Organization, OrganizationApi } from '@linode/gitea-client-fetch'
import { isEmpty } from 'lodash'
import { isUnprocessableError } from '../helpers'
import { errors } from '../globals'

// Exported for testing purposes
export async function upsertOrganization(
  orgApi: OrganizationApi,
  existingOrganizations: Organization[],
  organizationName: string,
): Promise<Organization> {
  const prefixedOrgName = !organizationName.includes('otomi') ? `team-${organizationName}` : organizationName
  const orgOption = {
    username: prefixedOrgName,
    fullName: prefixedOrgName,
    repoAdminChangeTeamAccess: true,
  }
  const existingOrg = existingOrganizations.find((organization) => organization.name === prefixedOrgName)
  if (isEmpty(existingOrg)) {
    try {
      console.info(`Creating organization "${orgOption.fullName}"`)
      return await orgApi.orgCreate({ organization: orgOption })
    } catch (e) {
      if (!isUnprocessableError(e)) {
        errors.push(`Error creating organization "${orgOption.fullName}": ${e}`)
      }
      throw e
    }
  }

  try {
    console.info(`Updating organization "${orgOption.fullName}"`)
    return await orgApi.orgEdit({ org: prefixedOrgName, body: orgOption })
  } catch (e) {
    if (!isUnprocessableError(e)) {
      errors.push(`Error updating organization "${orgOption.fullName}": ${e}`)
    }
    throw e
  }
}

export async function createOrganizations(
  orgApi: OrganizationApi,
  existingOrganizations: Organization[],
  organizationNames: string[],
): Promise<Organization[]> {
  await Promise.all(
    organizationNames.map(async (organizationName) => {
      const organization = await upsertOrganization(orgApi, existingOrganizations, organizationName)
      if (existingOrganizations.find((org) => org.id === organization.id)) return
      existingOrganizations.push(organization)
    }),
  )
  return existingOrganizations
}
