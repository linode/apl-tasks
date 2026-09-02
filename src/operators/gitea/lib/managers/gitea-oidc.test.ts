import { KubeConfig } from '@kubernetes/client-node'
import { GiteaConfig } from '../../gitea'
import { OIDC_SCOPES, setGiteaOIDCConfig } from './gitea-oidc'

const mockListNamespacedPod = jest.fn()
const mockExec = jest.fn()

jest.mock('@kubernetes/client-node', () => ({
  CoreV1Api: class {},
  Exec: jest.fn().mockImplementation(() => ({
    exec: (...args: unknown[]) => mockExec(...args),
  })),
  KubeConfig: jest.fn().mockImplementation(() => ({
    makeApiClient: () => ({ listNamespacedPod: mockListNamespacedPod }),
  })),
}))

describe('setGiteaOIDCConfig', () => {
  const giteaConfig = {
    oidcClientId: 'otomi',
    oidcClientSecret: 'client-secret',
    oidcEndpoint: 'https://idp.example.com',
    teamNames: ['demo'],
  } as GiteaConfig

  const execCommand = (): string => {
    const [, , , command] = mockExec.mock.calls[0] as [string, string, string, string[]]
    return command[2]
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockListNamespacedPod.mockResolvedValue({ items: [{ metadata: { name: 'gitea-0' } }] })
    mockExec.mockResolvedValue(undefined)
  })

  it('passes an explicit scope list when adding the auth source', async () => {
    await setGiteaOIDCConfig(giteaConfig, new KubeConfig())

    expect(execCommand()).toContain(`gitea admin auth add-oauth`)
    expect(execCommand()).toMatch(new RegExp(`add-oauth .*--scopes "${OIDC_SCOPES}"`))
  })

  it('passes an explicit scope list when updating the auth source', async () => {
    await setGiteaOIDCConfig(giteaConfig, new KubeConfig(), true)

    expect(execCommand()).toContain(`gitea admin auth update-oauth`)
    expect(execCommand()).toMatch(new RegExp(`update-oauth .*--scopes "${OIDC_SCOPES}"`))
  })

  it('requests the scope that carries group membership', () => {
    expect(OIDC_SCOPES.split(' ')).toContain('groups')
  })
})
