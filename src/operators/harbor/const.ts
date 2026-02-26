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

export const errors: string[] = []

export const robotPrefix = 'otomi-'

export const systemSecretName = 'harbor-robot-admin'
export const projectPullSecretName = 'harbor-pullsecret'
export const projectPushSecretName = 'harbor-pushsecret'
export const projectBuildPushSecretName = 'harbor-pushsecret-builds'
export const operatorSecretName = 'apl-harbor-operator-secret'
export const operatorConfigMapName = 'apl-harbor-operator-cm'
export const dockerConfigKey = '.dockerconfigjson'
