// Mock @kubernetes/client-node before any imports
import { upsertOrganization } from './lib/managers/gitea-organizations'
import { EditHookOption, Organization, User } from '@linode/gitea-client-fetch/'
import { getRepoNameFromUrl } from '../../gitea-utils'
import { addUserToOrganization, createUsers } from './lib/managers/gitea-users'
import { createBuildWebHook, deleteBuildWebHook, updateBuildWebHook } from './lib/managers/gitea-webhook'
import { buildTeamString } from './lib/helpers'

jest.mock('../../k8s', () => ({
  k8s: {
    core: jest.fn().mockReturnValue({
      replaceNamespacedSecret: jest.fn().mockResolvedValue({}),
      createNamespacedSecret: jest.fn().mockResolvedValue({}),
    }),
  },
}))

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: jest.fn().mockImplementation(() => ({
    loadFromDefault: jest.fn(),
    makeApiClient: jest.fn(),
  })),
  CoreV1Api: jest.fn(),
  Exec: jest.fn(),
  KubernetesObject: jest.fn(),
  V1Status: jest.fn(),
  PatchStrategy: {
    Apply: 'Apply',
  },
}))

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
    const mockedResponse = { id: 3, fullName: prefixedOrgName, repoAdminChangeTeamAccess: true, username: prefixedOrgName }
    const expectedResult = { id: 3, fullName: prefixedOrgName, repoAdminChangeTeamAccess: true, username: prefixedOrgName }

    jest.spyOn(organizationApi, 'orgCreate').mockResolvedValue(mockedResponse)
    const result = await upsertOrganization(organizationApi, existingOrgantizations, organizationName)
    
    expect(organizationApi.orgCreate).toHaveBeenCalledTimes(1)
    expect(result).toEqual(expectedResult)
  })
  
  it('should create service account for organization if it doesnt exist', async () => {
    const existingOrgantizations: Organization[] = [{ name: 'team-demo' }, { name: 'team-demo2' }, { name: 'team-demo3'}]
    const organizationName = 'team-demo3'
    const mockedListUsersResponse = [{ login: 'organization-team-demo' }, { login: 'organization-team-demo2' }]
    const mockedCreateUserResponse: User = { id: 3, email: 'organization-team-demo3@test.com', loginName: organizationName, fullName: organizationName, restricted: false }

    jest.spyOn(adminApi, 'adminSearchUsers').mockResolvedValue(mockedListUsersResponse)
    jest.spyOn(adminApi, 'adminCreateUser').mockResolvedValue(mockedCreateUserResponse)
    jest.spyOn(adminApi, 'adminEditUser').mockResolvedValue({})
    organizationApi.orgListTeams.mockResolvedValue([{ name: 'Owners', id: 1 }])
    organizationApi.orgListTeamMembers.mockResolvedValue([])

    await createUsers(adminApi, existingOrgantizations, organizationApi, '')
    expect(adminApi.adminCreateUser).toHaveBeenCalledTimes(1)
  })

  it('should recreate a service account secret if it does not exists anymore and update the service account', async () => {
    const existingOrgantizations: Organization[] = [{ name: 'team-demo3'}]
    const mockedListUsersResponse = [{ id: 1, login: 'organization-team-demo' }, { id: 2, login: 'organization-team-demo2' }, { id: 3, login: 'organization-team-demo3', loginName: 'organization-team-demo3' }]
    const mockEditUserResponse3: User = { id: 3, login: 'organization-team-demo3', loginName: 'organization-team-demo3' }

    jest.spyOn(adminApi, 'adminSearchUsers').mockResolvedValue(mockedListUsersResponse)
    jest.spyOn(adminApi, 'adminEditUser').mockResolvedValueOnce(mockEditUserResponse3)
    organizationApi.orgListTeams.mockResolvedValue([{ name: 'Owners', id: 1 }])
    organizationApi.orgListTeamMembers.mockResolvedValue([])

    await createUsers(adminApi, existingOrgantizations, organizationApi, '')
    expect(adminApi.adminEditUser).toHaveBeenCalledWith({ username: 'organization-team-demo3', body: { loginName: 'organization-team-demo3', password: expect.any(String), sourceId: 0 }})
  })

  it('should add service accounts to organizations', async () => {
    const existingOrgantizations: Organization[] = [{ name: 'team-demo' }, { name: 'team-demo2' }, { name: 'team-demo3'}]
    const loginName = 'organization-team-demo'
    const mockedListTeamsResponse = [{ name: 'Owners', id: 1 }, { name: 'team-demo' }, { name: 'team-demo2' }, { name: 'team-demo3' }]
    const mockedListUsersResponse = [{ login: 'test-user' }, { login: 'test-user-2' }]

    jest.spyOn(organizationApi, 'orgListTeams').mockResolvedValueOnce(mockedListTeamsResponse)
    jest.spyOn(organizationApi, 'orgListTeamMembers').mockResolvedValueOnce(mockedListUsersResponse)
    jest.spyOn(organizationApi, 'orgAddTeamMember').mockResolvedValueOnce({})

    await addUserToOrganization(organizationApi, loginName, existingOrgantizations)

    expect(organizationApi.orgAddTeamMember).toHaveBeenCalledWith({ id: 1, username: 'organization-team-demo' })
  })

  it('should create a webhook inside a repo of an organization', async () => {
    const teamId = 'team-demo'
    const buildWorkspace: { buildName: string; repoUrl: string } = { buildName: 'demo', repoUrl: 'https://gitea.test.net/team-demo/blue'}
    repositoryApi.repoListHooks.mockResolvedValue([])
    repositoryApi.repoCreateHook.mockResolvedValue({})
    const response = await createBuildWebHook(repositoryApi, teamId, buildWorkspace)

    expect(response).toEqual(undefined)
  })

  it('should update a webhook inside a repo of an organization', async () => {
    const teamId = 'team-demo'
    const buildWorkspace: { buildName: string; repoUrl: string } = { buildName: 'demo', repoUrl: 'https://gitea.test.net/team-demo/blue'}
    const repoName = getRepoNameFromUrl(buildWorkspace.repoUrl)!
    const editHookOption: EditHookOption = {
      active: true,
      events: ['push'],
      config: {
        content_type: 'json',
        url: `http://el-gitea-webhook-${buildWorkspace.buildName}.${teamId}.svc.cluster.local:8080`,
      },
    }

    repositoryApi.repoListHooks.mockResolvedValue([{ id: 1 }])
    repositoryApi.repoEditHook.mockResolvedValue({})
    await updateBuildWebHook(repositoryApi, teamId, buildWorkspace)

    expect(repositoryApi.repoEditHook).toHaveBeenCalledWith({ owner: teamId, repo: repoName, id: 1, body: editHookOption})
  })

  it('should delete a webhook inside a repo of an organization', async () => {
    const teamId = 'team-demo'
    const buildWorkspace: { buildName: string; repoUrl: string } = { buildName: 'demo', repoUrl: 'https://gitea.test.net/team-demo/blue'}
    const repoName = getRepoNameFromUrl(buildWorkspace.repoUrl)!

    repositoryApi.repoListHooks.mockResolvedValue([{ id: 1 }])
    repositoryApi.repoDeleteHook.mockResolvedValue({})
    await deleteBuildWebHook(repositoryApi, teamId, buildWorkspace)

    expect(repositoryApi.repoDeleteHook).toHaveBeenCalledWith({ owner: teamId, repo: repoName, id: 1 })
  })

  it('should create a valid group mapping string with all the teams', () => {
    const mappingString = buildTeamString(teamNames)
    expect(mappingString).toBe(
      '{"platform-admin":{"otomi":["Owners"]},"team-demo":{"otomi":["otomi-viewer","team-demo"],"team-demo":["Owners"]},"team-demo2":{"otomi":["otomi-viewer","team-demo2"],"team-demo2":["Owners"]},"team-demo3":{"otomi":["otomi-viewer","team-demo3"],"team-demo3":["Owners"]}}'
    )
    expect(mappingString).not.toContain('team-admin')
  })
})
