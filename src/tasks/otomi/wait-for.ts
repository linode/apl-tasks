/* eslint-disable no-await-in-loop */
/* eslint-disable no-loop-func */
/* eslint-disable no-undef */
import retry, { Options } from 'async-retry'
import { Agent } from 'https'
import fetch, { RequestInit } from 'node-fetch'
import { cleanEnv, WAIT_OPTIONS, WAIT_URL } from '../../validators'

type WaitTillAvailableOptions = {
  status?: number
  retries?: number
  skipSsl?: boolean
  username?: string
  password?: string
}

const env = cleanEnv({ WAIT_OPTIONS, WAIT_URL })

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const waitTillAvailable = async (url: string, opts?: WaitTillAvailableOptions): Promise<void> => {
  const defaultOptions: WaitTillAvailableOptions = { status: 200, retries: 10, skipSsl: false }
  const options: WaitTillAvailableOptions = { ...defaultOptions, ...opts }
  const retryOptions: Options = {
    retries: options.retries,
    forever: options.retries === 0,
    factor: 2,
    // minTimeout: The number of milliseconds before starting the first retry. Default is 1000.
    minTimeout: 1000,
    // The maximum number of milliseconds between two retries.
    maxTimeout: 30000,
  }

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

  // we don't trust dns in the cluster and want a lot of confirmations
  // but we don't care about those when we call the cluster from outside
  let count = 0
  try {
    do {
      await retry(async (bail) => {
        try {
          const res = await fetch(url, fetchOptions)
          if (res.status !== options.status) {
            console.warn(`GET ${res.url} ${res.status} ${options.status}`)
            bail(new Error(`Retry`))
          } else {
            count += 1
            console.debug(`${count}/${options.retries} success`)
            await sleep(1000)
          }
        } catch (e) {
          // Print system errors like ECONNREFUSED
          console.error(e.message)
          count = 0
          throw e
        }
      }, retryOptions)
    } while (count < options.retries!)
    console.debug(`Waiting done, ${count}/${options.retries} found`)
  } catch (e) {
    throw new Error(`Max retries (${retryOptions.retries}) has been reached!`)
  }
}

waitTillAvailable(env.WAIT_URL, env.WAIT_OPTIONS)
