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

export default function extractSecrets(schema: any, parentAddress?: string): Array<string> {
  return Object.keys(schema)
    .flatMap((key) => {
      const childObj = schema[key]
      if (typeof childObj !== 'object') return false
      if ('x-secret' in childObj) return parentAddress ? `${parentAddress}.${key}` : key
      let address
      if (schemaKeywords.includes(key) || !isNaN(Number(key))) address = parentAddress
      else if (parentAddress === undefined) address = key
      else address = `${parentAddress}.${key}`
      return extractSecrets(childObj, address)
    })
    .filter(Boolean) as Array<string>
}

function mergeValues(targetPath: string, valueObject): void {
  let bsValues
  if (fs.existsSync(targetPath)) {
    bsValues = yaml.load(fs.readFileSync(targetPath).toString())
  }
  if (!bsValues) {
    bsValues = {}
  }
  merge(bsValues, valueObject)
  fs.writeFileSync(targetPath, yaml.safeDump(bsValues))
}

async function main(): Promise<void> {
  const values = yaml.safeLoad(fs.readFileSync(env.OTOMI_VALUES_INPUT, 'utf8')) as any

  // creating secret files
  const schema = yaml.safeLoad(fs.readFileSync(env.OTOMI_SCHEMA_PATH, 'utf8')) as any
  const derefSchema = await $RefParser.dereference(schema)
  const cleanSchema = omit(derefSchema, ['definitions', 'properties.teamConfig']) // FIXME: lets fix the team part later
  const secretsJsonPath = extractSecrets(cleanSchema)
  const secrets = pick(values, secretsJsonPath)
  // mergeValues('secrets.team', { teamConfig: secrets.teamConfig }, destinationPath) // FIXME: lets fix the team part later
  const secretSettings = omit(secrets, ['cluster', 'policies', 'teamConfig', 'charts'])
  mergeValues(`${env.OTOMI_VALUES_TARGET}/secrets.settings.yaml`, secretSettings)
  Object.keys(secrets.charts).forEach((chart) => {
    const valueObject = {
      charts: {
        [chart]: values.charts[chart],
      },
    }
    mergeValues(`${env.OTOMI_VALUES_TARGET}/charts/secrets.${chart}.yaml`, valueObject)
  })

  // removing secrets
  const plainValues = omit(values, secretsJsonPath) as any

  // creating non secret files
  mergeValues(`${env.OTOMI_VALUES_TARGET}/cluster.yaml`, { cluster: plainValues.cluster })
  mergeValues(`${env.OTOMI_VALUES_TARGET}/policies.yaml`, { policies: plainValues.policies })
  mergeValues(`${env.OTOMI_VALUES_TARGET}/teams.yaml`, { teamConfig: plainValues.teamConfig })

  const settings = omit(plainValues, ['cluster', 'policies', 'teamConfig', 'charts'])
  mergeValues(`${env.OTOMI_VALUES_TARGET}/settings.yaml`, settings)

  Object.keys(plainValues.charts).forEach((chart) => {
    const valueObject = {
      charts: {
        [chart]: plainValues.charts[chart],
      },
    }
    mergeValues(`${env.OTOMI_VALUES_TARGET}/charts/${chart}.yaml`, valueObject)
  })

  console.log('otomi chart values merged with the bootstrapped values.')
}
main()
