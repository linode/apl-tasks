import { expect } from 'chai'
import { getPublicUrl } from './utils'

describe('Utils', () => {
  it('should retrieve host part from service domain', (done) => {
    const x = getPublicUrl('aa.bb.cc.dd.ee', null, null, { dnsZones: ['dd.ee'] })
    expect(x.subdomain).to.equal('aa.bb.cc')
    done()
  })

  it('should retrieve only domain', (done) => {
    const x = getPublicUrl('my.custom.domain', null, null, { dnsZones: ['dd.ee'] })
    expect(x.subdomain).to.be.empty
    expect(x.domain).to.equal('my.custom.domain')
    done()
  })
  it('should retrieve default host if service domain not defined', (done) => {
    const x = getPublicUrl(undefined, 'aa', 'bb', { name: 'dev', dnsZones: ['dd.ee'] })
    expect(x.subdomain).to.equal('aa.team-bb.dev')
    expect(x.domain).to.equal('dd.ee')
    done()
  })
  it('should retrieve host and domain part from service domai (many dnsZones)n', (done) => {
    const x = getPublicUrl('aa.bb.cc.dd.ee', 'aa', 'bb', { dnsZones: ['cc.dd.ee', 'dd.ee', 'bb.cc.dd.ee'] })
    expect(x.subdomain).to.equal('aa')
    expect(x.domain).to.equal('bb.cc.dd.ee')
    done()
  })
})
