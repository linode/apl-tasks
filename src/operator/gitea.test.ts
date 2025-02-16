import { buildTeamString } from './gitea'

describe('giteaOperator', () => {
  const teamNames = ['demo', 'demo2', 'demo3']

  it('should create a valid group mapping string with all the teams', () => {
    const mappingString = buildTeamString(teamNames)
    expect(mappingString).toBe(
      '{"platform-admin":{"otomi":["Owners"]},"team-demo":{"otomi":["otomi-viewer","team-demo"],"demo":["Owners"]},"team-demo2":{"otomi":["otomi-viewer","team-demo2"],"demo2":["Owners"]},"team-demo3":{"otomi":["otomi-viewer","team-demo3"],"demo3":["Owners"]}}'
    )
    expect(mappingString).not.toContain('team-admin')
  })
})
