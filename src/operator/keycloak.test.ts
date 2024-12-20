import { expect } from 'chai'
import sinon from 'sinon'
import { updateUserGroups } from './keycloak'

describe('Keycloak User Group Management', () => {
  let api: any
  let existingUser: any
  let keycloakRealm: string

  beforeEach(() => {
    keycloakRealm = 'otomi'
    existingUser = { id: 'user-id' }
    api = {
      users: {
        realmUsersIdGroupsGet: sinon.stub(),
        realmUsersIdGroupsGroupIdDelete: sinon.stub(),
        realmUsersIdGroupsGroupIdPut: sinon.stub(),
      },
      groups: {
        realmGroupsGet: sinon.stub(),
      },
    }
  })

  afterEach(() => {
    sinon.restore()
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
      api.users.realmUsersIdGroupsGet.resolves({ body: existingUserGroups })

      await updateUserGroups(api, existingUser, groupsById, ['group1'])

      expect(api.users.realmUsersIdGroupsGroupIdDelete.calledWith(keycloakRealm, 'user-id', 'group2-id')).to.be.true
      expect(api.users.realmUsersIdGroupsGroupIdDelete.calledWith(keycloakRealm, 'user-id', 'group1-id')).to.be.false
    })
  })

  describe('addUserGroups', () => {
    it('should add user to groups in teamGroups if not already present', async () => {
      const groupsById = {
        group1: 'group1-id',
        group2: 'group2-id',
      }
      const existingUserGroups = [{ name: 'group1', id: 'group1-id' }]
      api.users.realmUsersIdGroupsGet.resolves({ body: existingUserGroups })

      await updateUserGroups(api, existingUser, groupsById, ['group1', 'group2'])

      expect(api.users.realmUsersIdGroupsGroupIdPut.calledWith(keycloakRealm, 'user-id', 'group2-id')).to.be.true
      expect(api.users.realmUsersIdGroupsGroupIdPut.calledWith(keycloakRealm, 'user-id', 'group1-id')).to.be.false
    })
  })
})
