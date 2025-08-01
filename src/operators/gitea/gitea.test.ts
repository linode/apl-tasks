import { EditHookOption, Organization, User } from '@linode/gitea-client-node/'
import * as giteaUtils from '../../gitea-utils'
import { getRepoNameFromUrl, setServiceAccountSecret } from '../../gitea-utils'
import * as giteaOperator from './gitea'

describe('giteaOperator', () => {
  let adminApi: any
  let organizationApi: any
  let repositoryApi: any
  const teamNames = ['demo', 'demo2', 'demo3']
  beforeEach(() => {
    adminApi = {
      adminGetAllUsers: jest.fn(),
      adminCreateUser: jest.fn(),
      adminEditUser: jest.fn(),
      adminSearchUsers: jest.fn(),
    }
    organizationApi = {
      orgGetAll: jest.fn(),
      orgCreate: jest.fn(),
      orgEdit: jest.fn(),
      orgListTeams: jest.fn(),
      orgCreateTeam: jest.fn(),
      orgEditTeam: jest.fn(),
      orgListTeamMembers: jest.fn(),
      orgAddTeamMember: jest.fn(),
      orgListRepos: jest.fn(),
      createOrgRepo: jest.fn(),
    }
    repositoryApi = {
      repoEdit: jest.fn(),
      repoAddTeam: jest.fn(),
      repoListHooks: jest.fn(),
      repoCreateHook: jest.fn(),
      repoEditHook: jest.fn(),
      repoDeleteHook: jest.fn(),
    }
  })
  afterEach(() => {
    // Reset all Jest mocks between tests
    jest.restoreAllMocks()
  })

  it('should create organizations for missing team', async () => {
    const existingOrgantizations: Organization[] = [{ name: 'team-demo' }, { name: 'team-demo2' }]
    const organizationName = 'team-demo3'
    const prefixedOrgName = `team-demo3`
    const mockedResponse = { body: { id: 3, fullName: prefixedOrgName, repoAdminChangeTeamAccess: true, username: prefixedOrgName }}
    const expectedResult = { id: 3, fullName: prefixedOrgName, repoAdminChangeTeamAccess: true, username: prefixedOrgName }

    jest.spyOn(organizationApi, 'orgCreate').mockResolvedValue(mockedResponse)
    const result = await giteaOperator.upsertOrganization(organizationApi, existingOrgantizations, organizationName)
    
    expect(organizationApi.orgCreate).toHaveBeenCalledTimes(1)
    expect(result).toEqual(expectedResult)
  })
  
  it('should create service account for organization if it doesnt exist', async () => {
    const existingOrgantizations: Organization[] = [{ name: 'team-demo' }, { name: 'team-demo2' }, { name: 'team-demo3'}]
    const organizationName = 'team-demo3'
    const mockedListUsersResponse = { body: [{ login: 'organization-team-demo' }, { login: 'organization-team-demo2' }]}
    const mockedCreateUserResponse: User = { id: 3, email: 'organization-team-demo3@test.com', loginName: organizationName, fullName: organizationName, restricted: false }

    jest.spyOn(adminApi, 'adminSearchUsers').mockResolvedValue(mockedListUsersResponse)
    jest.spyOn(adminApi, 'adminCreateUser').mockResolvedValue(mockedCreateUserResponse)
    jest.spyOn(giteaUtils, 'setServiceAccountSecret').mockResolvedValue(undefined)
    jest.spyOn(giteaOperator, 'addServiceAccountToOrganizations').mockImplementation(jest.fn())

    await giteaOperator.createServiceAccounts(adminApi, existingOrgantizations, organizationApi)
    expect(adminApi.adminCreateUser).toHaveBeenCalledTimes(1)
  })

  it('should recreate a service account secret if it does not exists anymore and update the service account', async () => {
    const existingOrgantizations: Organization[] = [{ name: 'team-demo3'}]
    const mockedListUsersResponse = { body: [{ id: 1, login: 'organization-team-demo' }, { id: 2, login: 'organization-team-demo2' }, { id: 3, login: 'organization-team-demo3', loginName: 'organization-team-demo3' }]}
    const mockEditUserResponse1: User = { id: 1, login: 'organization-team-demo1', loginName: 'organization-team-demo1' }
    const mockEditUserResponse2: User = { id: 2, login: 'organization-team-demo2', loginName: 'organization-team-demo2' }
    const mockEditUserResponse3: User = { id: 3, login: 'organization-team-demo3', loginName: 'organization-team-demo3' }

    jest.spyOn(adminApi, 'adminSearchUsers').mockResolvedValue(mockedListUsersResponse)

    jest.spyOn(adminApi, 'adminEditUser').mockResolvedValueOnce(mockEditUserResponse1)
    jest.spyOn(giteaUtils, 'setServiceAccountSecret').mockResolvedValueOnce(undefined)
    
    jest.spyOn(adminApi, 'adminEditUser').mockResolvedValueOnce(mockEditUserResponse2)
    jest.spyOn(giteaUtils, 'setServiceAccountSecret').mockResolvedValueOnce(undefined)

    jest.spyOn(adminApi, 'adminEditUser').mockResolvedValueOnce(mockEditUserResponse3)
    jest.spyOn(giteaUtils, 'setServiceAccountSecret').mockResolvedValueOnce(undefined)


    jest.spyOn(giteaOperator, 'addServiceAccountToOrganizations').mockImplementation(jest.fn())

    await giteaOperator.createServiceAccounts(adminApi, existingOrgantizations, organizationApi)
    expect(adminApi.adminEditUser).toHaveBeenCalledWith('organization-team-demo3', { loginName: 'organization-team-demo3', password: expect.any(String) })
    expect(setServiceAccountSecret).toHaveBeenCalled()
  })

  it('should add service accounts to organizations', async () => {
    const existingOrgantizations: Organization[] = [{ name: 'team-demo' }, { name: 'team-demo2' }, { name: 'team-demo3'}]
    const loginName = 'organization-team-demo'
    const mockedListTeamsResponse = { body: [{ name: 'Owners', id: 1 }, { name: 'team-demo' }, { name: 'team-demo2' }, { name: 'team-demo3' }]}
    const mockedListUsersResponse = { body: [{ login: 'test-user' }, { login: 'test-user-2' }]}

    jest.spyOn(organizationApi, 'orgListTeams').mockResolvedValueOnce(mockedListTeamsResponse)
    jest.spyOn(organizationApi, 'orgListTeamMembers').mockResolvedValueOnce(mockedListUsersResponse)
    jest.spyOn(organizationApi, 'orgAddTeamMember').mockResolvedValueOnce({})

    await giteaOperator.addServiceAccountToOrganizations(organizationApi, loginName, existingOrgantizations)

    expect(organizationApi.orgAddTeamMember).toHaveBeenCalledWith(1, 'organization-team-demo')
  })

  it('should create a webhook inside a repo of an organization', async () => {
    const teamId = 'team-demo'
    const buildWorkspace: { buildName: string; repoUrl: string } = { buildName: 'demo', repoUrl: 'https://gitea.test.net/team-demo/blue'}
    repositoryApi.repoListHooks.mockResolvedValue({ body: []})
    repositoryApi.repoCreateHook.mockResolvedValue({})
    const response = await giteaOperator.createBuildWebHook(repositoryApi, teamId, buildWorkspace)

    expect(response).toEqual(undefined)
  })

  it('should update a webhook inside a repo of an organization', async () => {
    const teamId = 'team-demo'
    const buildWorkspace: { buildName: string; repoUrl: string } = { buildName: 'demo', repoUrl: 'https://gitea.test.net/team-demo/blue'}
    const repoName = getRepoNameFromUrl(buildWorkspace.repoUrl)!
    const editHookOption: EditHookOption = {
      ...new EditHookOption(),
      active: true,
      events: ['push'],
      config: {
        content_type: 'json',
        url: `http://el-gitea-webhook-${buildWorkspace.buildName}.${teamId}.svc.cluster.local:8080`,
      },
    }

    repositoryApi.repoListHooks.mockResolvedValue({ body: [ {id: 1}]})
    repositoryApi.repoEditHook.mockResolvedValue({})
    await giteaOperator.updateBuildWebHook(repositoryApi, teamId, buildWorkspace)

    expect(repositoryApi.repoEditHook).toHaveBeenCalledWith(teamId, repoName, 1, editHookOption)
  })

  it('should delete a webhook inside a repo of an organization', async () => {
    const teamId = 'team-demo'
    const buildWorkspace: { buildName: string; repoUrl: string } = { buildName: 'demo', repoUrl: 'https://gitea.test.net/team-demo/blue'}
    const repoName = getRepoNameFromUrl(buildWorkspace.repoUrl)!

    repositoryApi.repoListHooks.mockResolvedValue({ body: [ {id: 1}]})
    repositoryApi.repoDeleteHook.mockResolvedValue({})
    await giteaOperator.deleteBuildWebHook(repositoryApi, teamId, buildWorkspace)

    expect(repositoryApi.repoDeleteHook).toHaveBeenCalledWith(teamId, repoName, 1)
  })

  it('should create a valid group mapping string with all the teams', () => {
    const mappingString = giteaOperator.buildTeamString(teamNames)
    expect(mappingString).toBe(
      '{"platform-admin":{"otomi":["Owners"]},"team-demo":{"otomi":["otomi-viewer","team-demo"],"team-demo":["Owners"]},"team-demo2":{"otomi":["otomi-viewer","team-demo2"],"team-demo2":["Owners"]},"team-demo3":{"otomi":["otomi-viewer","team-demo3"],"team-demo3":["Owners"]}}'
    )
    expect(mappingString).not.toContain('team-admin')
  })
})
