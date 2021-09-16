import { omit, merge, pick } from 'lodash'
import yaml from 'js-yaml'
import fs from 'fs'
import $RefParser from '@apidevtools/json-schema-ref-parser'
import { cleanEnv, OTOMI_SCHEMA_PATH } from '../../validators'
import { cleanValues } from '../../utils'

const util = require('util')

const env = cleanEnv({
  OTOMI_SCHEMA_PATH,
})

const schemaKeywords = ['properties', 'anyOf', 'allOf', 'oneOf', 'not']

export function extractEssentialValues(schema: any, parentAddress?: string): Array<string> {
  return schema.required.flatMap((item) => {
    const property = schema.properties[item]
    const path = parentAddress ? `${parentAddress}.${item}` : item
    if (typeof property === 'object' && 'required' in property) {
      return extractEssentialValues(property, path)
    }
    return `| \`${path}\` | ${schema.properties[item]?.description || ''} | ${schema.properties[item]?.default || ''} |`
  })
}

export function extractAllRequiredValues(schema: any, parentAddress?: string): Array<string> {
  return Object.keys(schema)
    .flatMap((key) => {
      const childObj = schema[key]

      if (key === 'required') {
        return childObj.map((item) => {
          const parameter = parentAddress ? `${parentAddress}.${item}` : item
          return schema.properties && schema.properties[item] && schema.properties[item].description
            ? `| ${parameter} | ${schema.properties[item].description} |`
            : `| ${parameter} | |`
        })
      }
      if (typeof childObj !== 'object') return false
      let address
      if (schemaKeywords.includes(key) || !Number.isNaN(Number(key))) address = parentAddress
      else if (parentAddress === undefined) address = key
      else address = `${parentAddress}.${key}`
      return extractAllRequiredValues(childObj, address)
    })
    .filter(Boolean) as Array<string>
}
export function extractAllValuesPlusBranches(schema: any, parentAddress?: string): Array<string> {
  return Object.keys(schema)
    .flatMap((key) => {
      const childObj = schema[key]
      if (typeof childObj !== 'object') return []

      let address
      if (schemaKeywords.includes(key) || !Number.isNaN(Number(key))) address = parentAddress
      else if (parentAddress === undefined) address = key
      else address = `${parentAddress}.${key}`

      if ('default' in childObj || 'type' in childObj || 'description' in childObj) {
        const row = `| \`${address}\` | ${childObj?.description || ''} | ${childObj?.default || ''} |`
        return [row].concat(extractAllValuesPlusBranches(childObj, address))
      }
      return extractAllValuesPlusBranches(childObj, address)
    })
    .filter(Boolean)
}
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
  fs.writeFileSync('/Users/mojtaba/opt/allValues.md', str)
  console.log('done')
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
