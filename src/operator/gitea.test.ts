import { Organization, Team, User } from '@linode/gitea-client-node'
import * as giteaUtils from '../gitea-utils'
import * as utils from '../utils'
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
    const mockedResponse = { id: 3, fullName: prefixedOrgName, repoAdminChangeTeamAccess: true, username: prefixedOrgName } as Organization
    
    jest.spyOn(utils, 'doApiCall').mockResolvedValue(mockedResponse)
    const result = await giteaOperator.upsertOrganization(organizationApi, existingOrgantizations, organizationName)
    
    expect(utils.doApiCall).toHaveBeenCalledTimes(1)
    expect(result).toEqual(mockedResponse)
  })
  
  it('should create service account for organization if it doesnt exist', async () => {
    const existingOrgantizations: Organization[] = [{ name: 'team-demo' }, { name: 'team-demo2' }, { name: 'team-demo3'}]
    const organizationName = 'team-demo3'
    const mockedListUsersResponse: User[] = [{ login: 'organization-team-demo' }, { login: 'organization-team-demo2' }]
    const mockedCreateUserResponse: User = { id: 3, email: 'organization-team-demo3@test.com', loginName: organizationName, fullName: organizationName, restricted: false }

    jest.spyOn(utils, 'doApiCall').mockResolvedValueOnce(mockedListUsersResponse)
    jest.spyOn(utils, 'doApiCall').mockResolvedValue(mockedCreateUserResponse)
    jest.spyOn(giteaUtils, 'checkServiceAccountSecret').mockResolvedValue(undefined)
    jest.spyOn(giteaOperator, 'addServiceAccountsToOrganizations').mockImplementation(jest.fn())

    await giteaOperator.createServiceAccounts(adminApi, existingOrgantizations, organizationApi)
    
    expect(utils.doApiCall).toHaveBeenCalledTimes(2)
  })

  it('should recreate a service account secret if it does not exists anymore and update the service account', async () => {
    const existingOrgantizations: Organization[] = [{ name: 'team-demo' }, { name: 'team-demo2' }, { name: 'team-demo3'}]
    const organizationName = 'team-demo3'
    const mockedListUsersResponse: User[] = [{ id: 1, login: 'organization-team-demo' }, { id: 2, login: 'organization-team-demo2' }, { id: 3, login: 'organization-team-demo3', loginName: 'organization-team-demo3' }]
    const mockEditUserResponse: User = { id: 3, login: 'organization-team-demo3', loginName: 'organization-team-demo3' }

    jest.spyOn(utils, 'doApiCall').mockResolvedValueOnce(mockedListUsersResponse)
    jest.spyOn(giteaUtils, 'checkServiceAccountSecret').mockResolvedValueOnce(undefined)
    jest.spyOn(giteaUtils, 'checkServiceAccountSecret').mockResolvedValueOnce(undefined)
    jest.spyOn(giteaUtils, 'checkServiceAccountSecret').mockResolvedValueOnce('test3')
    jest.spyOn(utils, 'doApiCall').mockResolvedValueOnce(mockEditUserResponse)
    jest.spyOn(giteaOperator, 'addServiceAccountsToOrganizations').mockImplementation(jest.fn())

    await giteaOperator.createServiceAccounts(adminApi, existingOrgantizations, organizationApi)
    expect(utils.doApiCall).toHaveBeenCalledWith([], 'Getting all users', expect.any(Function))
    expect(utils.doApiCall).toHaveBeenNthCalledWith(2, [], `Editing user: ${mockEditUserResponse.loginName} with new password`, expect.any(Function))
  })

  it('should add service accounts to organizations', async () => {
    const existingOrgantizations: Organization[] = [{ name: 'team-demo' }, { name: 'team-demo2' }, { name: 'team-demo3'}]
    const loginName = 'organization-team-demo'
    const mockedListTeamsResponse: Team[] = [{ name: 'team-demo' }, { name: 'team-demo2' }, { name: 'team-demo3' }]
    const mockedListUsersResponse: User[] = [{ login: 'test-user' }, { login: 'test-user-2' }]

    jest.spyOn(utils, 'doApiCall').mockResolvedValueOnce(mockedListTeamsResponse)
    jest.spyOn(utils, 'doApiCall').mockResolvedValueOnce(mockedListUsersResponse)
    jest.spyOn(utils, 'doApiCall').mockResolvedValueOnce({})

    await giteaOperator.addServiceAccountsToOrganizations(organizationApi, loginName, existingOrgantizations)

    expect(utils.doApiCall).toHaveBeenCalledWith([], 'Getting teams from organization: team-demo', expect.any(Function))
    expect(utils.doApiCall).toHaveBeenNthCalledWith(3, [], 'Adding user to organization Owners team', expect.any(Function))
  })

  it('should create a valid group mapping string with all the teams', () => {
    const mappingString = giteaOperator.buildTeamString(teamNames)
    expect(mappingString).toBe(
      '{"platform-admin":{"otomi":["Owners"]},"team-demo":{"otomi":["otomi-viewer","team-demo"],"team-demo":["Owners"]},"team-demo2":{"otomi":["otomi-viewer","team-demo2"],"team-demo2":["Owners"]},"team-demo3":{"otomi":["otomi-viewer","team-demo3"],"team-demo3":["Owners"]}}'
    )
    expect(mappingString).not.toContain('team-admin')
  })
})
