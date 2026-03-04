jest.mock('../../../../k8s', () => ({
  createBuildsK8sSecret: jest.fn(),
  createK8sSecret: jest.fn(),
  createSecret: jest.fn(),
  getSecret: jest.fn(),
  replaceSecret: jest.fn(),
}))

import { parseDockerConfigJson } from './harbor-robots'

describe('parseDockerConfigJson', () => {
  const server = 'harbor.example.com'

  it('parses username/password from .dockerconfigjson', () => {
    const secret = {
      '.dockerconfigjson': JSON.stringify({
        auths: {
          [server]: {
            username: 'otomi-team-demo-pull',
            password: 'secret-token',
            email: 'not@val.id',
            auth: Buffer.from('otomi-team-demo-pull:secret-token').toString('base64'),
          },
        },
      }),
    }

    expect(parseDockerConfigJson(secret, server)).toEqual({
      username: 'otomi-team-demo-pull',
      password: 'secret-token',
    })
  })


  it('parses auth token from .dockerconfigjson', () => {
    const auth = Buffer.from('robot$team-build:build-token').toString('base64')
    const secret = {
      '.dockerconfigjson': JSON.stringify({
        auths: {
          [server]: {
            auth,
          },
        },
      }),
    }

    expect(parseDockerConfigJson(secret, server)).toEqual({
      username: 'robot$team-build',
      password: 'build-token',
    })
  })

  it('falls back to first auth entry when server key is missing', () => {
    const secret = {
      '.dockerconfigjson': JSON.stringify({
        auths: {
          'other.registry.local': {
            username: 'robot$default',
            password: 'default-token',
          },
        },
      }),
    }

    expect(parseDockerConfigJson(secret, server)).toEqual({
      username: 'robot$default',
      password: 'default-token',
    })
  })
  
  it('parses credentials from config.json (builds secret key)', () => {
    const secret = {
      'config.json': JSON.stringify({
        auths: {
          [server]: {
            username: 'robot$builds',
            password: 'builds-token',
          },
        },
      }),
    }

    expect(parseDockerConfigJson(secret, server)).toEqual({
      username: 'robot$builds',
      password: 'builds-token',
    })
  })

  it('returns undefined for invalid or missing docker config', () => {
    expect(parseDockerConfigJson({}, server)).toBeUndefined()
    expect(parseDockerConfigJson({ '.dockerconfigjson': '{invalid-json' }, server)).toBeUndefined()
    expect(
      parseDockerConfigJson(
        {
          '.dockerconfigjson': JSON.stringify({
            auths: {
              [server]: {
                auth: Buffer.from('missing-separator').toString('base64'),
              },
            },
          }),
        },
        server,
      ),
    ).toBeUndefined()
  })
})
