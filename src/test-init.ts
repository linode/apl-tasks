import { use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import sinon from 'sinon'
import sinonChai from 'sinon-chai'

use(chaiAsPromised)
use(sinonChai)

before(() => {
  sinon.stub(console, 'log')
  sinon.stub(console, 'debug')
  sinon.stub(console, 'info')
  sinon.stub(console, 'warn')
})
