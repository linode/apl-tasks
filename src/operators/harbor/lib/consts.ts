// consts
export const HarborRole = {
  admin: 1,
  developer: 2,
  guest: 3,
  master: 4,
}

export const HarborGroupType = {
  ldap: 1,
  http: 2,
}

export const ROBOT_PREFIX = 'otomi-'
export const SYSTEM_SECRET_NAME = 'harbor-robot-admin'
export const PROJECT_PULL_SECRET_NAME = 'harbor-pullsecret'
export const PROJECT_PUSH_SECRET_NAME = 'harbor-pushsecret'
export const PROJECT_BUILD_PUSH_SECRET_NAME = 'harbor-pushsecret-builds'
export const DEFAULT_ROBOT_PREFIX = 'robot$'
