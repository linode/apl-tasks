import { V1Secret, V1ServiceAccount } from '@kubernetes/client-node'
import { cloneDeep } from 'lodash'
import { createK8sSecret, deleteSecret, k8s } from './k8s'

jest.mock('@kubernetes/client-node', () => {
  const mockCoreClient = {
    createNamespacedSecret: jest.fn(),
    readNamespacedServiceAccount: jest.fn(),
    patchNamespacedServiceAccount: jest.fn(),
    deleteNamespacedSecret: jest.fn(),
  }
  const originalModule = jest.requireActual('@kubernetes/client-node')
  return {
    ...originalModule,
    CoreV1Api: jest.fn(),
    CustomObjectsApi: jest.fn(),
    KubeConfig: jest.fn().mockImplementation(() => ({
      loadFromDefault: jest.fn(),
      loadFromFile: jest.fn(),
      makeApiClient: jest.fn().mockReturnValue(mockCoreClient),
    })),
  }
})

describe('k8s', () => {
  const teamId = 'testtt'
  const namespace = `team-${teamId}`
  const name = 'somesecreettt'
  const server = 'eu.gcr.io'
  const data = { username: 'someusernameee', password: 'somepassworddd' }

  const secret: V1Secret = {
    metadata: { name },
    type: 'docker-registry',
    data: {
      '.dockerconfigjson': Buffer.from(JSON.stringify(data)).toString('base64'),
    },
  }

  const saNew: V1ServiceAccount = { metadata: { name: 'default' } }
  const saNewEmpty = { ...saNew, imagePullSecrets: [] }
  const saWithOtherSecret = { ...saNew, imagePullSecrets: [{ name: 'bla' }] }
  const saCombinedWithOtherSecret = { ...saNew, imagePullSecrets: [{ name: 'bla' }, { name }] }
  const saWithExistingSecret = { ...saNew, imagePullSecrets: [{ name }] }

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should create a valid pull secret and attach it to an SA without pullsecrets', async () => {
    jest.spyOn(k8s.core(), 'createNamespacedSecret').mockResolvedValue(cloneDeep(secret))
    jest.spyOn(k8s.core(), 'readNamespacedServiceAccount').mockResolvedValue(cloneDeep(saNew))

    // We'll store the patch spy, so we can assert on the final call
    const patchSpy = jest.spyOn(k8s.core(), 'patchNamespacedServiceAccount').mockResolvedValue(undefined as any)

    await createK8sSecret({ namespace, name, server, password: data.password, username: data.username })

    expect(patchSpy).toHaveBeenCalled()

    const args = patchSpy.mock.calls[0]
    expect(args[0]).toMatchObject({
      name: 'default',
      namespace,
      body: saWithExistingSecret,
    })
  })

  it('should create docker configjson content with auths schema', async () => {
    const createSpy = jest.spyOn(k8s.core(), 'createNamespacedSecret').mockResolvedValue(cloneDeep(secret))
    jest.spyOn(k8s.core(), 'readNamespacedServiceAccount').mockResolvedValue(cloneDeep(saNew))
    jest.spyOn(k8s.core(), 'patchNamespacedServiceAccount').mockResolvedValue(undefined as any)

    await createK8sSecret({
      namespace,
      name,
      server,
      username: 'tiger',
      password: 'pass1234',
      email: 'tiger@acme.example',
    })

    const dockerConfigBase64 = (createSpy.mock.calls[0][0].body as V1Secret).data?.['.dockerconfigjson']
    const dockerConfig = JSON.parse(Buffer.from(dockerConfigBase64!, 'base64').toString())

    expect(dockerConfig).toEqual({
      auths: {
        [server]: {
          username: 'tiger',
          password: 'pass1234',
          email: 'tiger@acme.example',
          auth: Buffer.from('tiger:pass1234').toString('base64'),
        },
      },
    })
  })

  it('should create a valid pull secret and attach it to an SA that has an empty pullsecrets array', async () => {
    jest.spyOn(k8s.core(), 'createNamespacedSecret').mockResolvedValue(cloneDeep(secret))
    jest.spyOn(k8s.core(), 'readNamespacedServiceAccount').mockResolvedValue(cloneDeep(saNewEmpty))
    const patchSpy = jest.spyOn(k8s.core(), 'patchNamespacedServiceAccount').mockResolvedValue(undefined as any)

    await createK8sSecret({ namespace, name, server, password: data.password, username: data.username })

    const args = patchSpy.mock.calls[0]
    expect(args[0]).toMatchObject({
      name: 'default',
      namespace,
      body: saWithExistingSecret,
    })
  })

  it('should create a valid pull secret and attach it to an SA that already has a pull secret', async () => {
    jest.spyOn(k8s.core(), 'createNamespacedSecret').mockResolvedValue(cloneDeep(secret))
    jest.spyOn(k8s.core(), 'readNamespacedServiceAccount').mockResolvedValue(cloneDeep(saWithOtherSecret))
    const patchSpy = jest.spyOn(k8s.core(), 'patchNamespacedServiceAccount').mockResolvedValue(undefined as any)

    await createK8sSecret({ namespace, name, server, password: data.password, username: data.username })

    const args = patchSpy.mock.calls[0]
    expect(args[0]).toMatchObject({
      name: 'default',
      namespace,
      body: saCombinedWithOtherSecret,
    })
  })

  it('should throw exception on secret creation for existing name', async () => {
    jest.spyOn(k8s.core(), 'createNamespacedSecret').mockImplementation(() => {
      throw { statusCode: 409 }
    })

    // Create the secret
    const check = createK8sSecret({
      namespace,
      name,
      server,
      password: data.password,
      username: data.username,
    })

    await expect(check).rejects.toThrow(`Secret '${name}' already exists in namespace '${namespace}'`)
  })

  it('should delete an existing pull secret successfully', async () => {
    jest
      .spyOn(k8s.core(), 'readNamespacedServiceAccount')
      .mockResolvedValue(cloneDeep(saWithExistingSecret))
    const patchSpy = jest.spyOn(k8s.core(), 'patchNamespacedServiceAccount').mockResolvedValue(undefined as any)
    const deleteSpy = jest.spyOn(k8s.core(), 'deleteNamespacedSecret').mockResolvedValue(undefined as any)

    await deleteSecret(namespace, name)

    const args = patchSpy.mock.calls[0]
    expect(args[0]).toMatchObject({
      name: 'default',
      namespace,
      body: saNewEmpty,
    })
    expect(deleteSpy).toHaveBeenCalledWith({ name, namespace })
  })
})
