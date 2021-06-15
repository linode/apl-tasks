import { omit, merge } from 'lodash'
import yaml from 'js-yaml'
import fs from 'fs'

const destinationPath = '/Users/mojtaba/opt/bootstrapfiles/env'
const sourcePath = '/Users/mojtaba/repo/github/redkubes/otomi-core/chart'

function mergeValues(cat: string, valueObject, folder: string) {
  const bsPath = `${folder}/${cat}.yaml`
  let bsValues = yaml.safeLoad(fs.readFileSync(bsPath), 'utf8')
  if (!bsValues) {
    bsValues = {}
  }
  merge(bsValues, valueObject)
  if (bsValues) {
    fs.writeFile(bsPath, yaml.safeDump(bsValues), (err) => {
      if (err) {
        console.log(err)
      } else {
        console.log(`The file ${bsPath} was saved`)
      }
    })
  }
}

try {
  const values = yaml.safeLoad(fs.readFileSync(`${sourcePath}/values.yaml`, 'utf8'))

  mergeValues('cluster', { cluster: values.cluster }, destinationPath)
  mergeValues('policies', { policies: values.policies }, destinationPath)
  mergeValues('teams', { teamConfig: values.teamConfig }, destinationPath)

  const settings = omit(values, ['cluster', 'policies', 'teamConfig', 'charts'])
  mergeValues('settings', settings, destinationPath)

  const charts = [
    'cert-manager',
    'drone',
    'external-dns',
    'gatekeeper-operator',
    'gitea',
    'keycloak',
    'loki',
    'otomi-api',
    'sitespeed',
    'vault',
    'weave-scope',
  ]

  charts.forEach((chart) => {
    const valueObject = {
      charts: {
        [chart]: values.charts[chart],
      },
    }
    mergeValues(chart, valueObject, `${destinationPath}/charts`)
  })

  console.log('done')
} catch (e) {
  console.log(e)
}
