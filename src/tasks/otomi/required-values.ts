import { omit } from 'lodash'
import yaml from 'js-yaml'
import fs from 'fs'
import $RefParser from '@apidevtools/json-schema-ref-parser'
import { cleanEnv, OTOMI_SCHEMA_PATH } from '../../validators'

const env = cleanEnv({
  OTOMI_SCHEMA_PATH,
})

const schemaKeywords = ['properties', 'anyOf', 'allOf', 'oneOf', 'not']

export function extractAllValues(schema: any, parentAddress?: string): Array<string> {
  return Object.keys(schema)
    .flatMap((key) => {
      if (
        key === 'type' &&
        !(typeof schema.type === 'object' && 'type' in schema[key]) && // sometimes 'type' is a property itself
        schema.type !== 'object' &&
        schema.type !== 'array'
      ) {
        const parameter = `\`${parentAddress?.replace(/\|/g, '\\|').replace(/items/g, '[]')}\``
        const type = `\`${schema.type}\``
        const description = `${schema?.description?.replace(/\n/g, ' ').replace(/\|/g, '\\|') || ''}`
        const defaalt = `\`${schema?.default || 'nil'}\``
        const row = `| ${parameter} | ${type} | ${description} | ${defaalt} |`
        return row
      }

      const childObj = schema[key]
      if (typeof childObj !== 'object') return false

      let address
      if (schemaKeywords.includes(key) || !Number.isNaN(Number(key))) address = parentAddress
      else if (!parentAddress) address = key
      else address = `${parentAddress}.${key}`
      return extractAllValues(childObj, address)
    })
    .filter(Boolean) as Array<string>
}

export default async function main(): Promise<void> {
  const schema = yaml.safeLoad(fs.readFileSync(env.OTOMI_SCHEMA_PATH, 'utf8')) as any
  const derefSchema = await $RefParser.dereference(schema)
  const cleanSchema = omit(derefSchema, ['definitions', 'properties.teamConfig'])
  // fs.writeFileSync('/Users/mojtaba/opt/clean-schema.yaml', yaml.safeDump(cleanSchema))

  const allValues = extractAllValues(cleanSchema)

  // generate markdown table string:
  let str = allValues.reduce((i, j) => `${i}\n${j}`)
  str = `|Parameter|Type|Description|Default|\n|-|-|-|-|\n${str}`
  fs.writeFileSync('allValues.md', str)
  console.log('done')
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
