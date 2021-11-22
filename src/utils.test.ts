import { CoreV1Api, V1ObjectMeta, V1Secret, V1ServiceAccount } from '@kubernetes/client-node'
import { expect } from 'chai'
import http from 'http'
import { cloneDeep } from 'lodash'
import fetch from 'node-fetch'
import sinon from 'sinon'
import './test-init'
import { createPullSecret, deletePullSecret, k8sCoreClient, objectToArray } from './utils'

describe('Secret creation', () => {
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
  const secretPromise: Promise<{ response: http.IncomingMessage | undefined; body: V1Secret }> = Promise.resolve({
    response: undefined,
    body: secret,
  })
  const saNew: V1ServiceAccount = { ...new V1ServiceAccount(), metadata: { name: 'default' } }
  const saNewEmpty = { ...saNew, imagePullSecrets: [] }
  const saWithOtherSecret = { ...saNew, imagePullSecrets: [{ name: 'bla' }] }
  const saCombinedWithOtherSecret = { ...saNew, imagePullSecrets: [{ name: 'bla' }, { name }] }
  const saWithExistingSecret = { ...saNew, imagePullSecrets: [{ name }] }
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

  const client: CoreV1Api = k8sCoreClient
  const successResp = Promise.resolve({ status: 200 })

  let sandbox
  beforeEach(() => {
    sandbox = sinon.createSandbox()
    sandbox.stub(fetch, 'Promise').returns(successResp)
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should convert an object to array', (done) => {
    const obj = {
      bla: {
        dida: 'okidoki',
      },
    }
    const res = [{ keyName: 'bla', keyValue: obj.bla }]
    const x = objectToArray(obj, 'keyName', 'keyValue')
    expect(x).to.deep.equal(res)
    done()
  })

  // it('should pass waitTillAvailable after 4 successful hits', async (done) => {
  //   await waitTillAvailable('bla')
  //   expect(fetch).to.have.been.callCount(4)
  //   done()
  // })

  it('should create a valid pull secret and attach it to an SA without pullsecrets', async () => {
    sandbox.stub(client, 'createNamespacedSecret').returns(secretPromise)
    sandbox.stub(client, 'readNamespacedServiceAccount').returns(newServiceAccountPromise)
    const patchSpy = sandbox.stub(client, 'patchNamespacedServiceAccount').returns(undefined as any)
    await createPullSecret({ teamId, name, server, password: data.password, username: data.username })
    expect(patchSpy).to.have.been.calledWith('default', namespace, saWithExistingSecret)
  })

  it('should create a valid pull secret and attach it to an SA that has an empty pullsecrets array', async () => {
    sandbox.stub(client, 'createNamespacedSecret').returns(secretPromise)
    sandbox.stub(client, 'readNamespacedServiceAccount').returns(newEmptyServiceAccountPromise)
    const patchSpy = sandbox.stub(client, 'patchNamespacedServiceAccount').returns(undefined as any)
    await createPullSecret({ teamId, name, server, password: data.password, username: data.username })
    expect(patchSpy).to.have.been.calledWith('default', namespace, saWithExistingSecret)
  })

  it('should create a valid pull secret and attach it to an SA that already has a pullsecret', async () => {
    sandbox.stub(client, 'createNamespacedSecret').returns(secretPromise)
    sandbox.stub(client, 'readNamespacedServiceAccount').returns(withOtherSecretServiceAccountPromise)
    const patchSpy = sandbox.stub(client, 'patchNamespacedServiceAccount').returns(undefined as any)
    await createPullSecret({ teamId, name, server, password: data.password, username: data.username })
    expect(patchSpy).to.have.been.calledWith('default', namespace, saCombinedWithOtherSecret)
  })

  it('should throw exception on secret creation for existing name', () => {
    sandbox.stub(client, 'createNamespacedSecret').throws(409)
    const check = createPullSecret({
      teamId,
      name,
      server,
      password: data.password,
      username: data.username,
    })
    return expect(check).to.eventually.be.rejectedWith(`Secret '${name}' already exists in namespace 'team-${teamId}'`)
  })

  it('should delete an existing pull secret successfully', async () => {
    sandbox.stub(client, 'readNamespacedServiceAccount').returns(withExistingSecretServiceAccountPromise)
    const patchSpy = sandbox.stub(client, 'patchNamespacedServiceAccount').returns(undefined as any)
    const deleteSpy = sandbox.stub(client, 'deleteNamespacedSecret').returns(undefined as any)
    await deletePullSecret(teamId, name)
    expect(patchSpy).to.have.been.calledWith('default', namespace, saNewEmpty)
    expect(deleteSpy).to.have.been.calledWith(name, namespace)
  })
})
