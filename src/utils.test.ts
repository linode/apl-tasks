import { expect } from 'chai'
import fetch from 'node-fetch'
import sinon from 'sinon'
import './test-init'
import { objectToArray, waitTillAvailable } from './utils'

describe('utils', () => {
  it('objectToArray should convert an object to array', (done) => {
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

  context('waitTillAvailablle', () => {
    let sandbox

    const tick = async (x, duration = 1000) => {
      for (let i = 0; i <= x; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve()
        sandbox.clock.tick(duration)
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve()
      }
    }

    beforeEach(() => {
      sandbox = sinon.createSandbox()
      sandbox.useFakeTimers()
    })

    afterEach(() => {
      sandbox.restore()
    })

    const successResp = Promise.resolve({ status: 200 })
    const failResp = Promise.resolve({ status: 500 })
    const url = 'https://bla.com'

    it('should pass after x successful requests', async () => {
      const stub = sandbox.stub(fetch, 'Promise').returns(successResp)
      const confirmations = 3
      const res = waitTillAvailable(url, undefined, { confirmations })
      await tick(confirmations + 2) // wait extra rounds
      expect(stub).to.have.callCount(confirmations)
      await expect(res).to.eventually.be.fulfilled
    })

    it('should reset confirmation counter', async () => {
      const stub = sandbox.stub(fetch, 'Promise').returns(successResp)
      const confirmations = 3
      const res = waitTillAvailable(url, undefined, { confirmations })
      await tick(confirmations + 2) // wait extra rounds
      expect(stub).to.have.callCount(confirmations)
      await expect(res).to.eventually.be.fulfilled
    })

    it('should bail when a request returns an unexpected status code', async () => {
      const stub = sandbox.stub(fetch, 'Promise').returns(failResp)
      const retries = 3
      const res = waitTillAvailable(url, undefined, { retries })
      await tick(retries + 1)
      expect(stub).to.have.callCount(1)
      await expect(res).to.eventually.be.rejectedWith(`Wrong status code: 500`)
    })

    it('should retry x times with backoff strategy after encountering connection issues', async () => {
      const stub = sandbox.stub(fetch, 'Promise').throws(new Error('ECONNREFUSED'))
      const retries = 3
      const maxTimeout = 30000
      const res = waitTillAvailable(url, undefined, { retries, maxTimeout })
      await tick(retries + 2, maxTimeout) // run a couple extra rounds and set duration to maxTimeout to make sure we have spent enough time
      expect(stub).to.have.callCount(3)
      await expect(res).to.eventually.be.rejectedWith(`Max retries (${retries}) has been reached!`)
    })

    it('should retry x times after encountering connection issues, then get y confirmations', async () => {
      const stub = sandbox.stub(fetch, 'Promise').throws(new Error('ECONNREFUSED'))
      const confirmations = 3
      const retries = 1000 // large enough
      const maxTimeout = 1000 // same as minTimeout to be able to calculate attempts
      const res = waitTillAvailable(url, undefined, { confirmations, retries, maxTimeout, forever: true })
      // tick 5 failures
      await tick(5)
      // now start returning ok responses
      stub.restore()
      sandbox.stub(fetch, 'Promise').returns(successResp)
      await tick(confirmations + 2) // wair for nr of confirmations
      await expect(res).to.eventually.be.fulfilled
    })
  })
})
