import { omit, merge } from 'lodash'

const fs = require('fs')
const yaml = require('js-yaml')

const destinationPath = '/Users/mojtaba/opt/bootstrapfiles/env'
const sourcePath = '/Users/mojtaba/repo/github/redkubes/otomi-core/chart'

try {
  const values = yaml.safeLoad(fs.readFileSync(`${sourcePath}/values.yaml`, 'utf8'))

  const settings = omit(values, ['charts', 'cluster', 'policies', 'teamConfig'])
  const { charts } = values
  const { cluster } = values
  const { policies } = values
  const { teamConfig } = values

  const settingsPath = `${destinationPath}/settings.yaml`
  const clusterPath = `${destinationPath}/cluster.yaml`
  const teamPath = `${destinationPath}/teams.yaml`
  const policiesPath = `${destinationPath}/policies.yaml`

  const bsSettings = yaml.safeLoad(fs.readFileSync(settingsPath, 'utf8'))
  const bsCluster = yaml.safeLoad(fs.readFileSync(clusterPath, 'utf8'))
  const bsTeams = yaml.safeLoad(fs.readFileSync(teamPath, 'utf8'))
  const bsPolicies = yaml.safeLoad(fs.readFileSync(policiesPath, 'utf8'))

  merge(bsSettings, settings)
  merge(bsCluster, cluster)
  merge(bsTeams, teamConfig)
  merge(bsPolicies, policies)

  fs.writeFile(settingsPath, yaml.safeDump(bsSettings), (err) => {
    if (err) {
      console.log(err)
    }
  })
  fs.writeFile(clusterPath, yaml.safeDump(bsCluster), (err) => {
    if (err) {
      console.log(err)
    }
  })
  fs.writeFile(teamPath, yaml.safeDump(bsTeams), (err) => {
    if (err) {
      console.log(err)
    }
  })
  fs.writeFile(policiesPath, yaml.safeDump(bsPolicies), (err) => {
    if (err) {
      console.log(err)
    }
  })

  console.log('done')
} catch (e) {
  console.log(e)
}
