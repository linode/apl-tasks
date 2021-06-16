import { omit, merge, pick } from 'lodash'
import yaml, { Schema } from 'js-yaml'
import fs from 'fs'
import $RefParser from '@apidevtools/json-schema-ref-parser'

const destinationPath = '/Users/mojtaba/opt/bootstrapfiles/env'
const sourcePath = '/Users/mojtaba/repo/github/redkubes/otomi-core/chart'
const schemaPath = '/Users/mojtaba/repo/github/redkubes/otomi-core/values-schema.yaml'
const schemaKeywords = ['properties', 'anyOf', 'allOf', 'oneOf']

function extractSecrets(values: any, parentKey: string): any {
  return Object.keys(values)
    .flatMap((key) => {
      const childObj = values[key]

      if (typeof childObj !== 'object') return false
      if ('x-secret' in childObj) {
        return `${parentKey}.${key}`
      }
      let address
      if (schemaKeywords.includes(key)) {
        address = parentKey
      } else {
        address = `${parentKey}.${key}`
      }
      return extractSecrets(childObj, address)
    })
    .filter(Boolean)
}
function mergeValues(cat: string, valueObject, folder: string): void {
  try {
    const bsPath = `${folder}/${cat}.yaml`

    let bsValues
    if (fs.existsSync(bsPath)) {
      bsValues = yaml.load(fs.readFileSync(bsPath).toString())
    }
    if (!bsValues) {
      bsValues = yaml.safeLoad('{}')
    }

    merge(bsValues, valueObject)
    fs.writeFileSync(bsPath, yaml.safeDump(bsValues))
  } catch (e) {
    console.log(e)
  }
}

async function main(): Promise<void> {
  try {
    const values = yaml.safeLoad(fs.readFileSync(`${sourcePath}/values.yaml`, 'utf8')) as any

    // creating secret files
    const schema = yaml.safeLoad(fs.readFileSync(schemaPath, 'utf8')) as any
    const derefSchema = await $RefParser.dereference(schema)
    const cleanSchema = omit(derefSchema, 'definitions')
    const secretsAddress = extractSecrets(cleanSchema, 'root').map((str) => str.replace('root.', ''))
    const secrets = pick(values, secretsAddress)
    mergeValues('secrets.team', { teamConfig: secrets.teamConfig }, destinationPath)
    const secretSettings = omit(secrets, ['cluster', 'policies', 'teamConfig', 'charts'])
    mergeValues('secrets.settings', secretSettings, destinationPath)
    Object.keys(secrets.charts).forEach((chart) => {
      const valueObject = {
        charts: {
          [chart]: values.charts[chart],
        },
      }
      mergeValues(`secrets.${chart}`, valueObject, `${destinationPath}/charts`)
    })

    // creating non secret files
    mergeValues('cluster', { cluster: values.cluster }, destinationPath)
    mergeValues('policies', { policies: values.policies }, destinationPath)
    mergeValues('teams', { teamConfig: values.teamConfig }, destinationPath)

    const settings = omit(values, ['cluster', 'policies', 'teamConfig', 'charts'])
    mergeValues('settings', settings, destinationPath)

    Object.keys(values.charts).forEach((chart) => {
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
}
main()
