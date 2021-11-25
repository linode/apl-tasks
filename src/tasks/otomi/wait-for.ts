/* eslint-disable no-await-in-loop */
/* eslint-disable no-loop-func */
/* eslint-disable no-undef */
import { Agent } from 'https'
import fetch, { RequestInit } from 'node-fetch'
import { cleanEnv, WAIT_OPTIONS, WAIT_URL } from '../../validators'

type WaitTillAvailableOptions = {
  status?: number
  // Number of succssfull consecutive respones
  retries?: number
  skipSsl?: boolean
  username?: string
  password?: string
  totalRetryCount?: number
}

const env = cleanEnv({ WAIT_OPTIONS, WAIT_URL })

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const waitTillAvailable = async (url: string, opts?: WaitTillAvailableOptions): Promise<void> => {
  const defaultOptions: WaitTillAvailableOptions = { totalRetryCount: 50, status: 200, retries: 10, skipSsl: false }
  const options: WaitTillAvailableOptions = { ...defaultOptions, ...opts }

  // Due to Boolean OR statement, first NODE_TLS_REJECT_UNAUTORIZED needs to be inverted
  // It is false if needs to skip SSL, and that doesn't work with OR
  // Then it needs to be negated again
  const rejectUnauthorized = !(options.skipSsl || !process.env.NODE_TLS_REJECT_UNAUTHORIZED)
  const fetchOptions: RequestInit = {
    redirect: 'follow',
    agent: new Agent({ rejectUnauthorized }),
  }
  if (options.username && options.password) {
    fetchOptions.headers = {
      Authorization: `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`,
    }
  }
  console.log(`Waiting until ${env.WAIT_URL} avaiable`)
  console.log(`Retry params: ${JSON.stringify(options)}`)
  console.debug(`Query params: ${JSON.stringify(fetchOptions)}`)
  // we don't trust dns in the cluster and want a lot of confirmations
  // but we don't care about those when we call the cluster from outside
  let count = 0
  let retryCount = 0
  do {
    retryCount += 1
    if (retryCount > options.totalRetryCount!)
      throw Error(`Max request count (${options.totalRetryCount!}) has been reached`)
    try {
      const res = await fetch(url, fetchOptions)
      if (res.status === options.status) count += 1
      else count = 0

      console.info(
        `req: GET ${res.url} res: ${res.status}, resExpected:${options.status}, ${count}/${options.retries} success, ${retryCount}/${options.totalRetryCount} attempt`,
      )
    } catch (e) {
      // Print system errors like ECONNREFUSED
      console.info(`req: GET ${url} error: ${e}`)
      count = 0
    }
    await sleep(1000)
  } while (count < options.retries!)
  console.debug(`Waiting done, ${count}/${options.retries} found`)
}

// Run main only on execution, not on import (like tests)
if (typeof require !== 'undefined' && require.main === module) {
  waitTillAvailable(env.WAIT_URL, env.WAIT_OPTIONS)
}
