import { expect } from 'chai'
import { objectToArray } from './utils'

describe('Utils', () => {
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
})
