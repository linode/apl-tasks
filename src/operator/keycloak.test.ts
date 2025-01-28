import { updateUserGroups } from './keycloak'

describe('Keycloak User Group Management', () => {
  let api: any
  let existingUser: any
  let keycloakRealm: string

  beforeEach(() => {
    keycloakRealm = 'otomi'
    existingUser = { id: 'user-id' }

    // Create a fresh mock 'api' object for each test
    api = {
      users: {
        realmUsersIdGroupsGet: jest.fn(),
        realmUsersIdGroupsGroupIdDelete: jest.fn(),
        realmUsersIdGroupsGroupIdPut: jest.fn(),
      },
      groups: {
        realmGroupsGet: jest.fn(),
      },
    }
  })

  afterEach(() => {
    // Reset all Jest mocks between tests
    jest.restoreAllMocks()
  })

  describe('removeUserGroups', () => {
    it('should remove user from groups not in teamGroups', async () => {
      const groupsById = {
        group1: 'group1-id',
        group2: 'group2-id',
      }
      const existingUserGroups = [
        { name: 'group1', id: 'group1-id' },
        { name: 'group2', id: 'group2-id' },
      ]

      // Simulate a successful fetch of the user’s current groups
      api.users.realmUsersIdGroupsGet.mockResolvedValue({ body: existingUserGroups })

      await updateUserGroups(api, existingUser, groupsById, ['group1'])

      // The user should be removed from 'group2-id' only
      expect(api.users.realmUsersIdGroupsGroupIdDelete).toHaveBeenCalledWith(
        keycloakRealm,
        'user-id',
        'group2-id'
      )
      // The user should NOT be removed from 'group1-id'
      expect(api.users.realmUsersIdGroupsGroupIdDelete).not.toHaveBeenCalledWith(
        keycloakRealm,
        'user-id',
        'group1-id'
      )
    })
  })

  describe('addUserGroups', () => {
    it('should add user to groups in teamGroups if not already present', async () => {
      const groupsById = {
        group1: 'group1-id',
        group2: 'group2-id',
      }
      const existingUserGroups = [
        { name: 'group1', id: 'group1-id' },
      ]

      // Mock the existing user groups response
      api.users.realmUsersIdGroupsGet.mockResolvedValue({ body: existingUserGroups })

      await updateUserGroups(api, existingUser, groupsById, ['group1', 'group2'])

      // The user should be added to 'group2-id'
      expect(api.users.realmUsersIdGroupsGroupIdPut).toHaveBeenCalledWith(
        keycloakRealm,
        'user-id',
        'group2-id'
      )
      // The user should NOT be re-added to 'group1-id'
      expect(api.users.realmUsersIdGroupsGroupIdPut).not.toHaveBeenCalledWith(
        keycloakRealm,
        'user-id',
        'group1-id'
      )
    })
  })
})
