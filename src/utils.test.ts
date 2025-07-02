import { emailTransformer, isObjectSubsetDifferent, objectToArray, waitTillAvailable } from './utils'

describe('utils', () => {
  describe('isObjectSubsetDifferent', () => {
    it('should detect equivalent objects', () => {
      expect(
        isObjectSubsetDifferent(
          { a: 1, b: 'x', c: { c1: false, c2: ['a', 'b'] } },
          { a: 1, b: 'x', c: { c1: false, c2: ['b', 'a'] } },
        ),
      ).toBe(false)
    })

    it('should detect subset equivalent objects', () => {
      expect(isObjectSubsetDifferent({ b: 'x', c: { c1: false } }, { a: 1, b: 'x', c: { c1: false } })).toBe(false)
    })

    it('should detect changes in objects', () => {
      expect(
        isObjectSubsetDifferent(
          { a: 1, b: 'y', c: { c1: false, c2: ['a', 'b'] } },
          { a: 1, b: 'x', c: { c1: false, c2: ['b', 'a'] } },
        ),
      ).toBe(true)
      expect(
        isObjectSubsetDifferent(
          { a: 2, b: 'x', c: { c1: false, c2: ['a', 'b'] } },
          { a: 1, b: 'x', c: { c1: false, c2: ['b', 'a'] } },
        ),
      ).toBe(true)
      expect(
        isObjectSubsetDifferent(
          { a: 1, b: 'x', c: { c1: true, c2: ['a', 'b'] } },
          { a: 1, b: 'x', c: { c1: false, c2: ['b', 'a'] } },
        ),
      ).toBe(true)
      expect(
        isObjectSubsetDifferent(
          { a: 1, b: 'x', c: { c1: false, c2: ['a', 'b', 'c'] } },
          { a: 1, b: 'x', c: { c1: false, c2: ['b', 'a'] } },
        ),
      ).toBe(true)
    })
  })

  it('objectToArray should convert an object to array', () => {
    const obj = {
      bla: {
        dida: 'okidoki',
      },
    }
    const res = [{ keyName: 'bla', keyValue: obj.bla }]
    const x = objectToArray(obj, 'keyName', 'keyValue')
    expect(x).toEqual(res)
  })

  describe('waitTillAvailable', () => {
    let spyFetch: jest.SpyInstance

    beforeEach(() => {
      spyFetch = jest.spyOn(global, 'fetch')
    })

    afterEach(() => {
      jest.useRealTimers()
      spyFetch.mockRestore()
    })

    const successResp = Promise.resolve({ status: 200 })
    const failResp = Promise.resolve({ status: 500 })
    const url = 'https://bla.com'

    it('should pass after x successful requests', async () => {
      spyFetch.mockResolvedValue(successResp)
      const confirmations = 3
      const res = waitTillAvailable(url, undefined, { confirmations })
      spyFetch = jest.spyOn(global, 'fetch')

      await expect(res).resolves.toBeUndefined()
      expect(spyFetch).toHaveBeenCalledTimes(confirmations)
    }, 10000)

    it('should bail when a request returns an unexpected status code', async () => {
      spyFetch.mockResolvedValue(failResp)
      const retries = 3
      const res = waitTillAvailable(url, undefined, { retries })

      await expect(res).rejects.toThrow('Wrong status code: 500')
      expect(spyFetch).toHaveBeenCalledTimes(1)
    })

    it('should retry x times with backoff strategy after encountering connection issues', async () => {
      spyFetch.mockRejectedValue(new Error('ECONNREFUSED'))
      const retries = 3
      const maxTimeout = 30000
      const res = waitTillAvailable(url, undefined, { retries, maxTimeout })

      await expect(res).rejects.toThrow(`Max retries (${retries}) has been reached!`)
      expect(spyFetch).toHaveBeenCalledTimes(3)
    }, 30000)

    it('should retry x times after encountering connection issues, then get y confirmations', async () => {
      spyFetch.mockRejectedValue(new Error('ECONNREFUSED'))
      const confirmations = 3
      const retries = 1000 // large enough
      const maxTimeout = 1000 // same as minTimeout to be able to calculate attempts
      const res = waitTillAvailable(url, undefined, { confirmations, retries, maxTimeout, forever: true })

      // Simulate 5 failures
      jest.advanceTimersByTime(5 * 1000) // Advance time by 5 seconds
      await Promise.resolve() // Allow promises to resolve

      // Now start returning ok responses
      spyFetch.mockRestore()
      // @ts-ignore
      spyFetch = jest.spyOn(global, 'fetch').mockResolvedValue(successResp)

      jest.advanceTimersByTime(confirmations * 1000) // Advance time by confirmations * 1000ms
      await Promise.resolve() // Allow promises to resolve

      await expect(res).resolves.toBeUndefined()
    })
  })

  it('should transform email to nickname', () => {
    const email = 'demo@test.com'
    const transformed = emailTransformer(email)
    expect(transformed).toBe('demo-test-com')
  })
})
