import type { Config } from '@jest/types'

const config: Config.InitialOptions = {
  roots: ['<rootDir>/src'],
  moduleDirectories: ['node_modules', __dirname],
  testEnvironment: 'node',
  transform: {
    '^.+.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
    '^.+\\.tsx?$': 'babel-jest',
    '^.+\\.jsx?$': 'babel-jest',
  },
  transformIgnorePatterns: ['node_modules/(?!(@kubernetes/client-node|openid-client|oauth4webapi|jose)/)'],
  silent: false,
  verbose: true,
}
export default config
process.env = Object.assign(process.env, {
  isDev: false,
})
