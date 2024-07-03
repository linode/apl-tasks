import Operator from '@dot-i/k8s-operator'

export default class MyOperator extends Operator {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  protected async init() {
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      console.info('Starting test operator')
      await this.watchResource('', 'v1', 'namespaces', async (e) => {
        const { object } = e
        const { metadata } = object
        await new Promise((resolve) => setTimeout(resolve, 1000))
        console.log('metadata', metadata?.name)
      })
      console.info('Listening test operator')
    } catch (error) {
      console.debug(error)
    }
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()
  console.info(`Listening namespaces`)
  await operator.start()

  process.on('uncaughtException', (err) => {
    console.error('There was an uncaught error', err)
    process.exit(1) // Mandatory (as per the Node.js docs)
  })

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
    process.exit(1)
  })

  const exit = (reason: string) => {
    console.log('reason', reason)
    operator.stop()
    process.exit(0)
  }

  process.on('SIGTERM', () => exit('SIGTERM')).on('SIGINT', () => exit('SIGINT'))
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
