// Mock @kubernetes/client-node before any imports
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

import * as keycloak from './keycloak'
import { createUpdateUser, manageUserProfile, updateUserGroups } from './keycloak'

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
  describe('createUpdateUser', () => {
    it('should not send credentials when updating an existing user', async () => {
      const existingUser = {
        id: 'user-123',
        email: 'test@example.com',
        requiredActions: [],
      }

      api.users.adminRealmsRealmUsersGet = jest.fn().mockResolvedValue({ body: [existingUser] })
      api.users.adminRealmsRealmUsersUserIdPut = jest.fn().mockResolvedValue({})
      api.groups.adminRealmsRealmGroupsGet = jest.fn().mockResolvedValue({ body: [] })
      api.users.adminRealmsRealmUsersUserIdGroupsGet = jest.fn().mockResolvedValue({ body: [] })

      const userConf = {
        email: 'test@example.com',
        firstName: 'Test-Updated',
        lastName: 'User',
        enabled: true,
        credentials: [{ type: 'password', value: 'initial-password', temporary: true }],
        groups: [],
      }

      await createUpdateUser(api, userConf)

      expect(api.users.adminRealmsRealmUsersUserIdPut).toHaveBeenCalledWith(
        'otomi',
        'user-123',
        expect.not.objectContaining({ credentials: expect.anything() }),
      )
    })

    it('should not send credentials even when user has UPDATE_PASSWORD action', async () => {
      const existingUser = {
        id: 'user-123',
        email: 'test@example.com',
        requiredActions: ['UPDATE_PASSWORD'],
      }

      api.users.adminRealmsRealmUsersGet = jest.fn().mockResolvedValue({ body: [existingUser] })
      api.users.adminRealmsRealmUsersUserIdPut = jest.fn().mockResolvedValue({})
      api.groups.adminRealmsRealmGroupsGet = jest.fn().mockResolvedValue({ body: [] })
      api.users.adminRealmsRealmUsersUserIdGroupsGet = jest.fn().mockResolvedValue({ body: [] })

      const userConf = {
        email: 'test@example.com',
        firstName: 'Test-Updated',
        lastName: 'User',
        enabled: true,
        credentials: [{ type: 'password', value: 'initial-password', temporary: true }],
        groups: [],
      }

      await createUpdateUser(api, userConf)

      expect(api.users.adminRealmsRealmUsersUserIdPut).toHaveBeenCalledWith(
        'otomi',
        'user-123',
        expect.not.objectContaining({ credentials: expect.anything() }),
      )
    })

    it('should request an exact email match from Keycloak', async () => {
      api.users.adminRealmsRealmUsersGet = jest.fn().mockResolvedValue({ body: [] })
      api.users.adminRealmsRealmUsersPost = jest.fn().mockResolvedValue({})
      api.groups.adminRealmsRealmGroupsGet = jest.fn().mockResolvedValue({ body: [] })

      await createUpdateUser(api, { email: 'member@example.com', groups: [] })

      // exact is the 6th positional argument of adminRealmsRealmUsersGet
      expect(api.users.adminRealmsRealmUsersGet).toHaveBeenCalledWith(
        'otomi',
        false,
        'member@example.com',
        undefined,
        undefined,
        true,
      )
    })

    it('should not update a user whose email only partially matches', async () => {
      const otherUser = {
        id: 'other-user-id',
        email: 'ln3-member@example.com',
        username: 'ln3-member@example.com',
      }

      api.users.adminRealmsRealmUsersGet = jest.fn().mockResolvedValue({ body: [otherUser] })
      api.users.adminRealmsRealmUsersUserIdPut = jest.fn().mockResolvedValue({})
      api.users.adminRealmsRealmUsersPost = jest.fn().mockResolvedValue({})
      api.groups.adminRealmsRealmGroupsGet = jest.fn().mockResolvedValue({ body: [] })
      api.users.adminRealmsRealmUsersUserIdGroupsGet = jest.fn().mockResolvedValue({ body: [] })

      const userConf = {
        email: 'member@example.com',
        firstName: 'Member',
        lastName: 'User',
        enabled: true,
        groups: [],
      }

      await createUpdateUser(api, userConf)

      // The unrelated account must never be renamed to the requested email
      expect(api.users.adminRealmsRealmUsersUserIdPut).not.toHaveBeenCalled()
      // The requested user does not exist yet, so it must be created
      expect(api.users.adminRealmsRealmUsersPost).toHaveBeenCalledWith('otomi', userConf)
    })

    it('should update the user that matches the requested email exactly', async () => {
      const otherUser = { id: 'other-user-id', email: 'ln3-member@example.com' }
      const targetUser = { id: 'target-user-id', email: 'member@example.com' }

      api.users.adminRealmsRealmUsersGet = jest.fn().mockResolvedValue({ body: [otherUser, targetUser] })
      api.users.adminRealmsRealmUsersUserIdPut = jest.fn().mockResolvedValue({})
      api.groups.adminRealmsRealmGroupsGet = jest.fn().mockResolvedValue({ body: [] })
      api.users.adminRealmsRealmUsersUserIdGroupsGet = jest.fn().mockResolvedValue({ body: [] })

      await createUpdateUser(api, {
        email: 'member@example.com',
        firstName: 'Member',
        lastName: 'User',
        enabled: true,
        groups: [],
      })

      expect(api.users.adminRealmsRealmUsersUserIdPut).toHaveBeenCalledWith(
        'otomi',
        'target-user-id',
        expect.objectContaining({ email: 'member@example.com' }),
      )
    })
  })

  describe('manageUsers', () => {
    it('should still delete removed users when one user fails to update', async () => {
      const users = [
        { email: 'good@example.com', firstName: 'Good', lastName: 'User', groups: [] },
        { email: 'bad@example.com', firstName: 'Bad', lastName: 'User', groups: [] },
      ]

      api.users.adminRealmsRealmUsersGet = jest.fn().mockImplementation((_realm, _brief, email) => {
        // The listing call for deleteUsers passes no email
        if (!email) {
          return Promise.resolve({
            body: [
              { id: 'good-id', email: 'good@example.com', username: 'good@example.com' },
              { id: 'stale-id', email: 'stale@example.com', username: 'stale@example.com' },
            ],
          })
        }
        if (email === 'bad@example.com') return Promise.reject(new Error('keycloak exploded'))
        return Promise.resolve({ body: [] })
      })
      api.users.adminRealmsRealmUsersPost = jest.fn().mockResolvedValue({})
      api.users.adminRealmsRealmUsersUserIdDelete = jest.fn().mockResolvedValue({})
      api.groups.adminRealmsRealmGroupsGet = jest.fn().mockResolvedValue({ body: [] })

      await expect(keycloak.manageUsers(api, users)).rejects.toThrow()

      expect(api.users.adminRealmsRealmUsersUserIdDelete).toHaveBeenCalledWith('otomi', 'stale-id')
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
