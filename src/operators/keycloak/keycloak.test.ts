import { UnmanagedAttributePolicy } from '@linode/keycloak-client-node'
import * as keycloak from './keycloak'
import { manageUserProfile, updateUserGroups } from './keycloak'

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
        adminRealmsRealmUsersUserIdGroupsGet: jest.fn(),
        adminRealmsRealmUsersUserIdGroupsGroupIdDelete: jest.fn(),
        adminRealmsRealmUsersUserIdGroupsGroupIdPut: jest.fn(),
        adminRealmsRealmUsersProfileGet: jest.fn(),
        adminRealmsRealmUsersProfilePut: jest.fn(),
      },
      groups: {
        adminRealmsRealmGroupsGet: jest.fn(),
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
      api.users.adminRealmsRealmUsersUserIdGroupsGet.mockResolvedValue({ body: existingUserGroups })

      await updateUserGroups(api, existingUser, groupsById, ['group1'])

      // The user should be removed from 'group2-id' only
      expect(api.users.adminRealmsRealmUsersUserIdGroupsGroupIdDelete).toHaveBeenCalledWith(
        keycloakRealm,
        'user-id',
        'group2-id'
      )
      // The user should NOT be removed from 'group1-id'
      expect(api.users.adminRealmsRealmUsersUserIdGroupsGroupIdDelete).not.toHaveBeenCalledWith(
        keycloakRealm,
        'user-id',
        'group1-id'
      )
    })
  })

  describe('updateRealmUserProfile', () => {
    it('should update realm user profile', async () => {
      api.users.adminRealmsRealmUsersProfileGet.mockResolvedValue({ body: { unmanagedAttributePolicy: undefined } })
      await manageUserProfile(api)

      // The realm user profile should be updated
      expect(api.users.adminRealmsRealmUsersProfilePut).toHaveBeenCalled()
    })

    it('should not update realm user profile', async () => {
      api.users.adminRealmsRealmUsersProfileGet.mockResolvedValue({ body: { unmanagedAttributePolicy: UnmanagedAttributePolicy.AdminEdit } })
      await manageUserProfile(api)

      // The realm user profile should not be updated
      expect(api.users.adminRealmsRealmUsersProfilePut).not.toHaveBeenCalled()
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
      api.users.adminRealmsRealmUsersUserIdGroupsGet.mockResolvedValue({ body: existingUserGroups })

      await updateUserGroups(api, existingUser, groupsById, ['group1', 'group2'])

      // The user should be added to 'group2-id'
      expect(api.users.adminRealmsRealmUsersUserIdGroupsGroupIdPut).toHaveBeenCalledWith(
        keycloakRealm,
        'user-id',
        'group2-id'
      )
      // The user should NOT be re-added to 'group1-id'
      expect(api.users.adminRealmsRealmUsersUserIdGroupsGroupIdPut).not.toHaveBeenCalledWith(
        keycloakRealm,
        'user-id',
        'group1-id'
      )
    })
  })
  describe('IDPManager', () => {
    let api: any

    beforeEach(() => {
      jest.mock('./keycloak', () => ({
        internalIDP: jest.fn(),
        externalIDP: jest.fn(),
        manageUsers: jest.fn(),
        IDPManager: jest.fn(async (api, externalIdp) => {
          if (externalIdp) {
            await keycloak.externalIDP(api)
          } else {
            await keycloak.internalIDP(api)
            await keycloak.manageUsers(api, [])
          }
        },
      )}))
      
      api = {
        providers: {},
        clientScope: {},
        roles: {},
        clientRoleMappings: {},
        roleMapper: {},
        clients: {},
        protocols: {},
        realms: {},
        users: {},
        groups: {},
      }
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('should call externalIDP when FEAT_EXTERNAL_IDP is "true"', async () => {
      const { IDPManager } = await import('./keycloak')

      jest.spyOn(keycloak, 'externalIDP').mockImplementation(jest.fn())
      
      await IDPManager(api, true)

      expect(keycloak.externalIDP).toHaveBeenCalled()
    })

    it('should call internalIdp and manageUsers when FEAT_EXTERNAL_IDP is not "true"', async () => {
      const { IDPManager } = await import('./keycloak')

      jest.spyOn(keycloak, 'internalIDP').mockImplementation(jest.fn())
      jest.spyOn(keycloak, 'manageUsers').mockImplementation(jest.fn())
      
      await IDPManager(api, false)

      expect(keycloak.internalIDP).toHaveBeenCalled()
      expect(keycloak.manageUsers).toHaveBeenCalled()
    })
  })
})
