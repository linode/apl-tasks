import { expect } from 'chai'
import { buildTeamString } from './gitea'

describe('giteaOperator', () => {
  const teamNames = ['demo', 'demo2', 'demo3']
  it('should create a valid group mapping string with all the teams', () => {
    const mappingString = buildTeamString(teamNames)
    expect(mappingString).to.be.equal(
      '{"platform-admin":{"otomi":["Owners"]},"team-demo":{"otomi":["otomi-viewer","team-demo"],"demo":["owners"]},"team-demo2":{"otomi":["otomi-viewer","team-demo2"],"demo2":["owners"]},"team-demo3":{"otomi":["otomi-viewer","team-demo3"],"demo3":["owners"]}}',
    )
    expect(mappingString).to.not.contain('team-admin')
  })
})
