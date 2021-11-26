/* eslint-disable no-loop-func */
/* eslint-disable no-await-in-loop */
import retry, { Options } from 'async-retry'
import http from 'http'
import { Agent } from 'https'
import fetch, { RequestInit } from 'node-fetch'

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function objectToArray(obj: any, keyName: string, keyValue: string): any[] {
  const arr = Object.keys(obj).map((key) => {
    const tmp = {}
    tmp[keyName] = key
    tmp[keyValue] = obj[key]
    return tmp
  })
  return arr
}

export type openapiResponse = {
  response: http.IncomingMessage
  body?: any
}

export async function doApiCall(
  errors: string[],
  action: string,
  fn: () => Promise<openapiResponse>,
  statusCodeExists = 409,
): Promise<any | undefined> {
  console.info(action)
  try {
    const res = await fn()
    const { body } = res
    return body
  } catch (e) {
    console.warn(e.body ?? `${e}`)
    if (e.statusCode) {
      if (e.statusCode === statusCodeExists) console.warn(`${action} > already exists.`)
      else errors.push(`${action} > HTTP error ${e.statusCode}: ${e.message}`)
    } else errors.push(`${action} > Unknown error: ${e.message}`)
    return undefined
  }
}

export function handleErrors(errors: string[]): void {
  if (errors.length) {
    console.error(`Errors found: ${JSON.stringify(errors, null, 2)}`)
    process.exit(1)
  } else {
    console.info('Success!')
  }
}

type WaitTillAvailableOptions =
  | Options & {
      confirmations?: number
      status?: number
      skipSsl?: boolean
      username?: string
      password?: string
    }

const defaultOptions: WaitTillAvailableOptions = {
  factor: 2,
  confirmations: 10,
  retries: 50,
  status: 200,
  skipSsl: false,
  minTimeout: 1000,
  maxTimeout: 30000,
}

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const waitTillAvailable = async (url: string, opts?: WaitTillAvailableOptions): Promise<void> => {
  const options: WaitTillAvailableOptions = { ...defaultOptions, ...opts }

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
  let confirmations = 0
  do {
    await retry(async (bail, attempt): Promise<void> => {
      try {
        const res = await fetch(url, fetchOptions)
        if (res.status !== options.status) {
          console.warn(`GET ${url} ${res.status} !== ${options.status}`)
          // we quit retrying if we get a response but not with the status code we expect
          bail(new Error(`Wrong status code: ${res.status}`))
        } else {
          confirmations += 1
          console.debug(`${confirmations}/${options.confirmations} success`)
          await sleep(1000)
        }
      } catch (e) {
        // Print system errors like ECONNREFUSED
        console.error(`Error in try #${attempt}: `, e.message)
        if (options.retries !== 0 && attempt === options.retries!) {
          bail(new Error(`Max retries (${options.retries}) has been reached!`))
        } else {
          throw e
        }
      }
    }, options)
  } while (confirmations < options.confirmations!)
  console.debug(`Waiting done, ${confirmations}/${options.confirmations} found`)
}
