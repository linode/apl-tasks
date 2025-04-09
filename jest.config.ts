import type { Config } from '@jest/types'

const config: Config.InitialOptions = {
  roots: ['<rootDir>/src'],
  moduleDirectories: ['node_modules', __dirname],
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': 'babel-jest',
    '^.+\\.jsx?$': 'babel-jest',
  },
  transformIgnorePatterns: ['node_modules/(?!(@kubernetes/client-node|openid-client|oauth4webapi)/)'],
  silent: false,
  verbose: true,
}
export default config
