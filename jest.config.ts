import type { Config } from '@jest/types'

const config: Config.InitialOptions = {
  roots: ['<rootDir>/src'],
  testEnvironment: 'node',
  preset: 'ts-jest',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@kubernetes/client-node|@linode/apl-k8s-operator|jose|uuid|openid-client|oauth4webapi)/)',
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  silent: false,
  verbose: true,
}

export default config

process.env = Object.assign(process.env, {
  isDev: false,
})
