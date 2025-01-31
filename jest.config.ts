import type { Config } from '@jest/types'

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  roots: ['<rootDir>/src'],
  moduleDirectories: ['node_modules', __dirname],
  testEnvironment: 'node',
  transform: {
    '^.+.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  silent: false,
  verbose: true,
}
export default config
process.env = Object.assign(process.env, {
  isDev: false,
})
