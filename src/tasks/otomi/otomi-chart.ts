import { omit, merge, pick } from 'lodash'
import yaml from 'js-yaml'
import fs from 'fs'
import $RefParser from '@apidevtools/json-schema-ref-parser'

import { cleanEnv, OTOMI_VALUES_INPUT, OTOMI_SCHEMA_PATH, OTOMI_VALUES_TARGET } from '../../validators'

const env = cleanEnv({
  OTOMI_VALUES_INPUT,
  OTOMI_SCHEMA_PATH,
  OTOMI_VALUES_TARGET,
})

const schemaKeywords = ['properties', 'anyOf', 'allOf', 'oneOf']

export default function extractSecrets(schema: any, parentKey: string): Array<string> {
  return Object.keys(schema)
    .flatMap((key) => {
      const childObj = schema[key]
      if (typeof childObj !== 'object') return false
      if ('x-secret' in childObj) return `${parentKey}.${key}`
      if (key in ['anyOf', 'allOf', 'oneOf']) return extractSecrets(childObj, parentKey)
      const address = schemaKeywords.includes(key) ? parentKey : `${parentKey}.${key}`
      return extractSecrets(childObj, address)
    })
    .filter(Boolean) as Array<string>
}

function mergeValues(cat: string, valueObject, folder: string): void {
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
}

async function main(): Promise<void> {
  const values = yaml.safeLoad(fs.readFileSync(env.OTOMI_VALUES_INPUT, 'utf8')) as any

  // creating secret files
  const schema = yaml.safeLoad(fs.readFileSync(env.OTOMI_SCHEMA_PATH, 'utf8')) as any
  const derefSchema = await $RefParser.dereference(schema)
  const cleanSchema = omit(derefSchema, ['definitions', 'properties.teamConfig']) // FIXME: lets fix the team part later
  const secretsJsonPath = extractSecrets(cleanSchema, 'root').map((str) => str.replace('root.', ''))
  const secrets = pick(values, secretsJsonPath)
  // mergeValues('secrets.team', { teamConfig: secrets.teamConfig }, destinationPath) // FIXME: lets fix the team part later
  const secretSettings = omit(secrets, ['cluster', 'policies', 'teamConfig', 'charts'])
  mergeValues('secrets.settings', secretSettings, env.OTOMI_VALUES_TARGET)
  Object.keys(secrets.charts).map((chart) => {
    const valueObject = {
      charts: {
        [chart]: values.charts[chart],
      },
    }
    mergeValues(`secrets.${chart}`, valueObject, `${env.OTOMI_VALUES_TARGET}/charts`)
  })

  // removing secrets
  const plainValues = omit(values, secretsJsonPath) as any

  // creating non secret files
  mergeValues('cluster', { cluster: plainValues.cluster }, env.OTOMI_VALUES_TARGET)
  mergeValues('policies', { policies: plainValues.policies }, env.OTOMI_VALUES_TARGET)
  mergeValues('teams', { teamConfig: plainValues.teamConfig }, env.OTOMI_VALUES_TARGET)

  const settings = omit(plainValues, ['cluster', 'policies', 'teamConfig', 'charts'])
  mergeValues('settings', settings, env.OTOMI_VALUES_TARGET)

  Object.keys(plainValues.charts).map((chart) => {
    const valueObject = {
      charts: {
        [chart]: plainValues.charts[chart],
      },
    }
    mergeValues(chart, valueObject, `${env.OTOMI_VALUES_TARGET}/charts`)
  })

  console.log('otomi chart values merged with the bootstrapped values.')
}
main()
