import { V1ObjectMeta, V1Secret, V1ServiceAccount } from '@kubernetes/client-node'
import http from 'http'
import { cloneDeep } from 'lodash'
import { createK8sSecret, deleteSecret, k8s } from './k8s'

describe('k8s', () => {
  const teamId = 'testtt'
  const namespace = `team-${teamId}`
  const name = 'somesecreettt'
  const server = 'eu.gcr.io'
  const data = { username: 'someusernameee', password: 'somepassworddd' }

  const secret: V1Secret = {
    ...new V1Secret(),
    metadata: { ...new V1ObjectMeta(), name },
    type: 'docker-registry',
    data: {
      '.dockerconfigjson': Buffer.from(JSON.stringify(data)).toString('base64'),
    },
  }

  // Simulated return from createNamespacedSecret
  const secretPromise: Promise<{ response: http.IncomingMessage | undefined; body: V1Secret }> = Promise.resolve({
    response: undefined,
    body: secret,
  })

  const saNew: V1ServiceAccount = { ...new V1ServiceAccount(), metadata: { name: 'default' } }
  const saNewEmpty = { ...saNew, imagePullSecrets: [] }
  const saWithOtherSecret = { ...saNew, imagePullSecrets: [{ name: 'bla' }] }
  const saCombinedWithOtherSecret = { ...saNew, imagePullSecrets: [{ name: 'bla' }, { name }] }
  const saWithExistingSecret = { ...saNew, imagePullSecrets: [{ name }] }

  // Simulated returns from readNamespacedServiceAccount
  const newServiceAccountPromise = Promise.resolve({
    response: undefined as any,
    body: cloneDeep(saNew),
  })
  const newEmptyServiceAccountPromise = Promise.resolve({
    response: undefined as any,
    body: cloneDeep(saNewEmpty),
  })
  const withOtherSecretServiceAccountPromise = Promise.resolve({
    response: undefined as any,
    body: cloneDeep(saWithOtherSecret),
  })
  const withExistingSecretServiceAccountPromise = Promise.resolve({
    response: undefined as any,
    body: cloneDeep(saWithExistingSecret),
  })

  const successResp = Promise.resolve({ status: 200 })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('should create a valid pull secret and attach it to an SA without pullsecrets', async () => {
    jest.spyOn(k8s.core(), 'createNamespacedSecret').mockReturnValue(secretPromise as any)
    jest.spyOn(k8s.core(), 'readNamespacedServiceAccount').mockReturnValue(newServiceAccountPromise as any)

    // We'll store the patch spy, so we can assert on the final call
    const patchSpy = jest.spyOn(k8s.core(), 'patchNamespacedServiceAccount').mockResolvedValue(undefined as any)

    await createK8sSecret({ namespace, name, server, password: data.password, username: data.username })

    expect(patchSpy).toHaveBeenCalledWith(
      'default',
      namespace,
      saWithExistingSecret,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        headers: { 'content-type': 'application/strategic-merge-patch+json' },
      },
    )
  })

  it('should create a valid pull secret and attach it to an SA that has an empty pullsecrets array', async () => {
    jest.spyOn(k8s.core(), 'createNamespacedSecret').mockReturnValue(secretPromise as any)
    jest.spyOn(k8s.core(), 'readNamespacedServiceAccount').mockReturnValue(newEmptyServiceAccountPromise as any)
    const patchSpy = jest.spyOn(k8s.core(), 'patchNamespacedServiceAccount').mockResolvedValue(undefined as any)

    await createK8sSecret({ namespace, name, server, password: data.password, username: data.username })

    expect(patchSpy).toHaveBeenCalledWith(
      'default',
      namespace,
      saWithExistingSecret,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        headers: { 'content-type': 'application/strategic-merge-patch+json' },
      },
    )
  })

  it('should create a valid pull secret and attach it to an SA that already has a pullsecret', async () => {
    jest.spyOn(k8s.core(), 'createNamespacedSecret').mockReturnValue(secretPromise as any)
    jest.spyOn(k8s.core(), 'readNamespacedServiceAccount').mockReturnValue(withOtherSecretServiceAccountPromise as any)
    const patchSpy = jest.spyOn(k8s.core(), 'patchNamespacedServiceAccount').mockResolvedValue(undefined as any)

    await createK8sSecret({ namespace, name, server, password: data.password, username: data.username })

    expect(patchSpy).toHaveBeenCalledWith(
      'default',
      namespace,
      saCombinedWithOtherSecret,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        headers: { 'content-type': 'application/strategic-merge-patch+json' },
      },
    )
  })

  it('should throw exception on secret creation for existing name', async () => {
    // If your code interprets a 409 thrown by the k8s call as "secret already exists,"
    // you should throw a real error object or something your code recognizes.
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
      .mockReturnValue(withExistingSecretServiceAccountPromise as any)
    const patchSpy = jest.spyOn(k8s.core(), 'patchNamespacedServiceAccount').mockResolvedValue(undefined as any)
    const deleteSpy = jest.spyOn(k8s.core(), 'deleteNamespacedSecret').mockResolvedValue(undefined as any)

    await deleteSecret(namespace, name)

    expect(patchSpy).toHaveBeenCalledWith(
      'default',
      namespace,
      saNewEmpty,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        headers: { 'content-type': 'application/strategic-merge-patch+json' },
      },
    )
    expect(deleteSpy).toHaveBeenCalledWith(name, namespace)
  })
})
