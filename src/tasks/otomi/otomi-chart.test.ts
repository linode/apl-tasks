import { expect } from 'chai'
import extractSecrets from './otomi-chart'

describe('otomi-chart', () => {
  it('It should extract the json path of the secrets found in the schema', () => {
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
        provider: {
          properties: {
            oneOf: [
              { aws: { password: { type: 'string', [`x-secret`]: 'true' } } },
              { google: { password: { type: 'string', [`x-secret`]: 'true' } } },
              { azure: { password: { type: 'string', [`x-secret`]: 'true' } } },
            ],
          },
        },
      },
    }
    const expectedResult = [
      'root.pullSecret',
      'root.provider.aws.password',
      'root.provider.google.password',
      'root.provider.azure.password',
    ]
    const x = extractSecrets(schema, 'root')
    expect(x).to.deep.equal(expectedResult)
  })

  it('It should return an empty array if the input schema is empty', () => {
    const schema = {}
    const expectedResult = []
    const x = extractSecrets(schema, '')
    expect(x).to.deep.equal(expectedResult)
  })
})
