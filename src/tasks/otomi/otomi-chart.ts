import { omit, merge, pick, isNumber } from 'lodash'
import yaml from 'js-yaml'
import fs from 'fs'
import $RefParser from '@apidevtools/json-schema-ref-parser'

const destinationPath = '/Users/mojtaba/opt/bootstrapfiles/env'
const sourcePath = '/Users/mojtaba/repo/github/redkubes/otomi-core/chart'
const schemaPath = '/Users/mojtaba/repo/github/redkubes/otomi-core/values-schema.yaml'

const schemaKeywords = ['properties', 'anyOf', 'allOf', 'oneOf']

function extractSecrets(schema: any, parentKey: string): any {
  return Object.keys(schema)
    .flatMap((key) => {
      const childObj = schema[key]
      if (typeof childObj !== 'object') return false
      if ('x-secret' in childObj) return `${parentKey}.${key}`
      if (key in ['anyOf', 'allOf', 'oneOf']) return extractSecrets(childObj, parentKey)
      const address = schemaKeywords.includes(key) ? parentKey : `${parentKey}.${key}`
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
      bsValues = {}
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
    const cleanSchema = omit(derefSchema, ['definitions', 'properties.teamConfig']) // FIXME: lets fix the team part later
    const secretsJsonPath = extractSecrets(cleanSchema, 'root').map((str) => str.replace('root.', ''))
    console.log(secretsJsonPath)
    const secrets = pick(values, secretsJsonPath)
    console.log(secrets)
    // mergeValues('secrets.team', { teamConfig: secrets.teamConfig }, destinationPath) // FIXME: lets fix the team part later
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
    const plainValues = omit(values, secretsJsonPath) as any

    // creating non secret files
    mergeValues('cluster', { cluster: plainValues.cluster }, destinationPath)
    mergeValues('policies', { policies: plainValues.policies }, destinationPath)
    mergeValues('teams', { teamConfig: plainValues.teamConfig }, destinationPath)

    const settings = omit(plainValues, ['cluster', 'policies', 'teamConfig', 'charts'])
    mergeValues('settings', settings, destinationPath)

    Object.keys(plainValues.charts).forEach((chart) => {
      const valueObject = {
        charts: {
          [chart]: plainValues.charts[chart],
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
