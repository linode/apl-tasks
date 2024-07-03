import Operator from '@dot-i/k8s-operator'

export default class MyOperator extends Operator {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  protected async init() {
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      console.info('Starting test operator')
      this.logger.info('Test log')
      console.info('Listening test operator')
    } catch (error) {
      console.debug(error)
    }
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()
  console.info(`Listening to secrets, configmaps and namespaces`)
  await operator.start()
  const exit = (reason: string) => {
    operator.stop()
    process.exit(0)
  }

  process.on('SIGTERM', () => exit('SIGTERM')).on('SIGINT', () => exit('SIGINT'))
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
