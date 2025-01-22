import { expect } from 'chai'
import { UserRepresentation } from '@linode/keycloak-client-node'
import { createTeamUser } from './realm-factory'

describe('createTeamUser', () => {
  it('should return a valid UserRepresentation with merged defaults', () => {
    const email = 'john@example.com'
    const firstName = 'John'
    const lastName = 'Doe'
    const groups = ['group1', 'group2']
    const initialPassword = 'password123'

    const userRepresentation: UserRepresentation = createTeamUser(
      email,
      firstName,
      lastName,
      groups,
      initialPassword
    )

    expect(userRepresentation.email).to.be.equal(email)
    expect(userRepresentation.enabled).to.be.true
    expect(userRepresentation.emailVerified).to.be.true
    expect(userRepresentation.username).to.be.equal(email)
    expect(userRepresentation.firstName).to.be.equal(firstName)
    expect(userRepresentation.lastName).to.be.equal(lastName)
    expect(userRepresentation.groups).to.eql(groups)
    expect(userRepresentation.realmRoles).to.eql(['teamMember'])
    expect(userRepresentation.requiredActions).to.eql([])
    expect(userRepresentation.credentials![0]).to.eql({
      type: 'password',
      value: initialPassword,
      temporary: true,
    })

    expect(userRepresentation.attributes).to.be.an('object')
    const transformed = email.replace(/@/g, '-').replace(/\./g, '-')
    expect(userRepresentation.attributes!.nickname).to.be.equal(transformed)
  })

  it('should correctly transform various email formats for the nickname', () => {
    const testCases = [
      { email: 'simple@domain.com', expected: 'simple-domain-com' },
      { email: 'with.dots@some.co.uk', expected: 'with-dots-some-co-uk' },
      { email: 'no-dots@domain', expected: 'no-dots-domain' },
    ]

    for (const { email, expected } of testCases) {
      const userRep = createTeamUser(email, 'FName', 'LName', [], 'pw')
      expect(userRep.attributes).to.be.an('object')
      expect(userRep.attributes!.nickname).to.be.equal(expected)
    }
  })
})
