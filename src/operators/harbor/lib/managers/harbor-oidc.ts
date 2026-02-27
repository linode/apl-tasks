import { Configurations, ConfigureApi } from '@linode/harbor-client-node'
import { log } from 'console'
import { ROBOT_PREFIX } from '../consts'
import { HarborConfig } from '../types/oidc'

export async function manageHarborOidcConfig(configureApi: ConfigureApi, harborConfig: HarborConfig): Promise<void> {
  const config: Configurations = {
    authMode: 'oidc_auth',
    oidcAdminGroup: 'platform-admin',
    oidcClientId: 'otomi',
    oidcClientSecret: harborConfig.oidcClientSecret,
    oidcEndpoint: harborConfig.oidcEndpoint,
    oidcGroupsClaim: 'groups',
    oidcName: 'otomi',
    oidcScope: 'openid',
    oidcVerifyCert: harborConfig.oidcVerifyCert,
    oidcUserClaim: harborConfig.oidcUserClaim,
    oidcAutoOnboard: harborConfig.oidcAutoOnboard,
    projectCreationRestriction: 'adminonly',
    robotNamePrefix: ROBOT_PREFIX,
    selfRegistration: false,
    primaryAuthMode: true,
  }

  log('Putting Harbor configuration')
  await configureApi.updateConfigurations(config)
  log('Harbor configuration updated successfully')
}
