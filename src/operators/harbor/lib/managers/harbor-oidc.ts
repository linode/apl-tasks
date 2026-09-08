import { Configurations, ConfigureApi } from '@linode/harbor-client-node'
import { log } from 'console'
import { DEFAULT_OIDC_NAME, DEFAULT_OIDC_SCOPE, ROBOT_PREFIX } from '../consts'
import { HarborConfig } from '../types/oidc'

export default async function manageHarborOidcConfig(
  configureApi: ConfigureApi,
  harborConfig: HarborConfig,
): Promise<void> {
  const config: Configurations = {
    authMode: 'oidc_auth',
    oidcAdminGroup: 'platform-admin',
    oidcClientId: 'otomi',
    oidcClientSecret: harborConfig.oidcClientSecret,
    oidcEndpoint: harborConfig.oidcEndpoint,
    oidcGroupsClaim: 'groups',
    oidcName: harborConfig.oidcName || DEFAULT_OIDC_NAME,
    oidcScope: harborConfig.oidcScope || DEFAULT_OIDC_SCOPE,
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
