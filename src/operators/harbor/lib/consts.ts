// consts
export const HARBOR_ROLE = {
  admin: 1,
  developer: 2,
  guest: 3,
  master: 4,
}

export const HARBOR_GROUP_TYPE = {
  ldap: 1,
  http: 2,
}

export const ROBOT_PREFIX = 'otomi-'
export const SYSTEM_SECRET_NAME = 'harbor-robot-admin'
export const PROJECT_PULL_SECRET_NAME = 'harbor-pullsecret'
export const PROJECT_PUSH_SECRET_NAME = 'harbor-pushsecret'
export const PROJECT_BUILD_PUSH_SECRET_NAME = 'harbor-pushsecret-builds'
export const DEFAULT_ROBOT_PREFIX = 'robot$'
export const DOCKER_CONFIG_KEY = '.dockerconfigjson'
export const HARBOR_TOKEN_TYPE_PULL = 'pull'
export const HARBOR_TOKEN_TYPE_PUSH = 'push'
export const HARBOR_ROBOT_PULL_SUFFIX = 'pull'
export const HARBOR_ROBOT_PUSH_SUFFIX = 'push'
export const HARBOR_ROBOT_BUILD_SUFFIX = 'builds'
