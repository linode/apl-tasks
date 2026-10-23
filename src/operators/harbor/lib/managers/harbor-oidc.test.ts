import { Configurations, ConfigureApi } from '@linode/harbor-client-fetch'
import { DEFAULT_OIDC_NAME, DEFAULT_OIDC_SCOPE } from '../consts'
import { HarborConfig } from '../types/oidc'
import manageHarborOidcConfig from './harbor-oidc'

describe('manageHarborOidcConfig', () => {
  const mockConfigureApi = {
    updateConfigurations: jest.fn(),
  }

  const configureApi = mockConfigureApi as unknown as ConfigureApi

  const expectConfigurations = (configurations: Partial<Configurations>) =>
    expect.objectContaining({ configurations: expect.objectContaining(configurations) })

  const harborConfig = (overrides: Partial<HarborConfig> = {}): HarborConfig =>
    ({
      harborBaseRepoUrl: 'harbor.example.com',
      harborUser: 'admin',
      harborPassword: 'password',
      oidcClientId: 'otomi',
      oidcClientSecret: 'client-secret',
      oidcEndpoint: 'https://idp.example.com',
      oidcVerifyCert: true,
      oidcUserClaim: 'email',
      oidcAutoOnboard: true,
      oidcGroupsClaim: 'groups',
      oidcName: 'keycloak',
      oidcScope: 'openid email profile groups',
      teamNamespaces: [],
      ...overrides,
    }) as HarborConfig

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('configures Harbor with the scope supplied in the configuration', async () => {
    await manageHarborOidcConfig(configureApi, harborConfig())

    expect(mockConfigureApi.updateConfigurations).toHaveBeenCalledWith(
      expectConfigurations({ oidcScope: 'openid email profile groups' }),
    )
  })

  it('falls back to the default scope when no scope is supplied', async () => {
    await manageHarborOidcConfig(configureApi, harborConfig({ oidcScope: undefined }))

    expect(mockConfigureApi.updateConfigurations).toHaveBeenCalledWith(
      expectConfigurations({ oidcScope: DEFAULT_OIDC_SCOPE }),
    )
  })

  it('falls back to the default scope when an empty scope is supplied', async () => {
    await manageHarborOidcConfig(configureApi, harborConfig({ oidcScope: '' }))

    expect(mockConfigureApi.updateConfigurations).toHaveBeenCalledWith(
      expectConfigurations({ oidcScope: DEFAULT_OIDC_SCOPE }),
    )
  })

  it('configures Harbor with the identity provider name supplied in the configuration', async () => {
    await manageHarborOidcConfig(configureApi, harborConfig({ oidcName: 'dex' }))

    expect(mockConfigureApi.updateConfigurations).toHaveBeenCalledWith(expectConfigurations({ oidcName: 'dex' }))
  })

  it('falls back to the default identity provider name when none is supplied', async () => {
    await manageHarborOidcConfig(configureApi, harborConfig({ oidcName: '' }))

    expect(mockConfigureApi.updateConfigurations).toHaveBeenCalledWith(
      expectConfigurations({ oidcName: DEFAULT_OIDC_NAME }),
    )
  })

  it('keeps the remaining configuration unchanged', async () => {
    await manageHarborOidcConfig(configureApi, harborConfig())

    expect(mockConfigureApi.updateConfigurations).toHaveBeenCalledWith(
      expectConfigurations({
        authMode: 'oidc_auth',
        oidcAdminGroup: 'platform-admin',
        oidcClientId: 'otomi',
        oidcClientSecret: 'client-secret',
        oidcEndpoint: 'https://idp.example.com',
        oidcGroupsClaim: 'groups',
        oidcUserClaim: 'email',
        oidcAutoOnboard: true,
        oidcVerifyCert: true,
        projectCreationRestriction: 'adminonly',
        selfRegistration: false,
        primaryAuthMode: true,
      }),
    )
  })
})
