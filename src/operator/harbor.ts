import Operator from '@dot-i/k8s-operator'

export default class MyOperator extends Operator {
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
      console.error('Failed to initialize operator:', error)
      // Consider a retry mechanism here or ensure the error is handled appropriately.
    }
  }
}

async function main(): Promise<void> {
  const operator = new MyOperator()
  console.info(`Listening namespaces`)
  try {
    await operator.start()
  } catch (error) {
    console.error('Operator failed to start:', error)
    process.exit(1) // Exit with error code if the operator fails to start
  }

  const exit = (reason: string) => {
    console.log('Shutdown reason:', reason)
    try {
      operator.stop()
      console.log('Operator stopped successfully.')
      process.exit(0) // Ensure a successful exit code on graceful shutdown
    } catch (error) {
      console.error('Failed to stop operator gracefully:', error)
      process.exit(1) // Exit with error code if there was an issue stopping
    }
  }

  process.on('SIGTERM', () => exit('SIGTERM')).on('SIGINT', () => exit('SIGINT'))
}

// Handle uncaught exceptions and unhandled promise rejections
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  process.exit(1) // Exit with error code on uncaught exceptions
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  // Application specific logging, throwing an error, or other logic here
})

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
