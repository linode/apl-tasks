import { expect } from 'chai'
import { teamUserCfgTpl } from './config'

describe('teamUserCfgTpl', () => {
  it('should return the correct user configuration object', () => {
    const email = 'demo@example.com'
    const firstName = 'John'
    const lastName = 'Doe'
    const groups = ['team-group']
    const initialPassword = 'secret123'

    const result = teamUserCfgTpl(email, firstName, lastName, groups, initialPassword)

    // Basic property checks:
    expect(result).to.have.property('username', email)
    expect(result).to.have.property('enabled', true)
    expect(result).to.have.property('email', email)
    expect(result).to.have.property('emailVerified', true)
    expect(result).to.have.property('firstName', firstName)
    expect(result).to.have.property('lastName', lastName)
    expect(result).to.have.property('realmRoles').that.eql(['teamMember'])
    expect(result).to.have.property('groups').that.eql(groups)
    expect(result).to.have.property('requiredActions').that.eql([])

    expect(result).to.have.property('credentials').that.is.an('array')
    const creds = (result.credentials as Array<Record<string, unknown>>)
    expect(creds[0]).to.deep.equal({
      type: 'password',
      value: initialPassword,
      temporary: true,
    })

    expect(result).to.have.property('attributes').that.is.an('object')
    const attrs = result.attributes as Record<string, unknown>
    expect(attrs).to.have.property('nickname', 'demo-example-com')
  })

  it('should correctly set nickname attribute', () => {
    const testCases = [
      { email: 'my.user@domain.co', expectedNickname: 'my-user-domain-co' },
      { email: 'user.name@email.org', expectedNickname: 'user-name-email-org' },
      { email: 'plain@domain', expectedNickname: 'plain-domain' },
    ]

    for (const { email, expectedNickname } of testCases) {
      const userConf = teamUserCfgTpl(email, 'Test', 'User', [], 'pw')

      expect(userConf).to.have.property('attributes').that.is.an('object')
      const attrs = userConf.attributes as Record<string, unknown>
      expect(attrs).to.have.property('nickname', expectedNickname)
    }
  })
})
