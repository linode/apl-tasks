import { expect } from 'chai'
import { buildTeamString } from './gitea'

describe('giteaOperator', () => {
  const teamNames = ['demo', 'demo2', 'demo3']
  it('should create a valid group mapping string with all the teams', () => {
    const mappingString = buildTeamString(teamNames)
    expect(mappingString).to.be.equal(
      '{"platform-admin":{"otomi":["Owners"]},"team-demo":{"demo":["otomi-viewer","team-demo"]},"team-demo2":{"demo2":["otomi-viewer","team-demo2"]},"team-demo3":{"demo3":["otomi-viewer","team-demo3"]}}',
    )
    expect(mappingString).to.not.contain('team-admin')
  })
})
