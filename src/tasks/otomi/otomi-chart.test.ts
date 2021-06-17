import { expect } from 'chai'
import extractSecrets from './otomi-chart'

describe('simple schema', () => {
  it('extract secrets json paths from schema', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema',
      additionalProperties: false,
      definitions: {
        rawValues: { description: 'bla bla', type: 'object' },
      },
      properties: {
        apps: { description: 'console.', type: 'object' },
        pullSecret: {
          description: 'console.',
          type: 'string',
          [`x-secret`]: 'true',
        },
        azure: {
          hello: {
            description: 'console.',
            type: 'string',
            [`x-secret`]: 'true',
          },
        },
      },
    }
    const expectedResult = ['root.pullSecret', 'root.azure.hello']
    const x = extractSecrets(schema, 'root')
    expect(x).to.deep.equal(expectedResult)
  })
})

describe('oneOf', () => {
  it('extract secrets json paths from schema', () => {
    const schema = {
      oneOf: [
        { aws: { password: { type: 'string', [`x-secret`]: 'true' } } },
        { google: { password: { type: 'string', [`x-secret`]: 'true' } } },
        { azure: { password: { type: 'string', [`x-secret`]: 'true' } } },
      ],
    }

    const expectedResult = ['root.aws.password', 'root.google.password', 'root.azure.password']
    const x = extractSecrets(schema, 'root')
    expect(x).to.deep.equal(expectedResult)
  })
})

describe('empty schema', () => {
  it('a simple schema', () => {
    const schema = {}
    const expectedResult = []
    const x = extractSecrets(schema, '')
    expect(x).to.deep.equal(expectedResult)
  })
})
