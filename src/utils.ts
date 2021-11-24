/* eslint-disable no-loop-func */
/* eslint-disable no-await-in-loop */
import retry, { Options } from 'async-retry'
import http from 'http'
import fetch, { RequestInit } from 'node-fetch'
import { cleanEnv } from './validators'

const env = cleanEnv({})

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

export function ensure<T>(argument: T | undefined | null, message = 'This value was promised to be there.'): T {
  if (argument === undefined || argument === null) {
    throw new TypeError(message)
  }

  return argument
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

export async function waitTillAvailable(url: string, status = 200): Promise<void> {
  if (env.isDev) return
  const retryOptions: Options = {
    retries: 10,
    factor: 2,
    // minTimeout: The number of milliseconds before starting the first retry. Default is 1000.
    minTimeout: 1000,
    // The maximum number of milliseconds between two retries.
    maxTimeout: 30000,
  }
  const minimumSuccessful = 10
  let count = 0
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  try {
    do {
      console.log('retry count: ', count)
      await retry(async (bail) => {
        try {
          const fetchOptions: RequestInit = {
            redirect: 'follow',
          }
          const res = await fetch(url, fetchOptions)
          if (res.status !== status) {
            console.warn(`GET ${res.url} ${res.status}`)
            bail(new Error(`Retry`))
          } else {
            count += 1
            await delay(1000)
          }
        } catch (e) {
          // Print system errors like ECONNREFUSED
          console.error(e.message)
          count = 0
          throw e
        }
      }, retryOptions)
    } while (count < minimumSuccessful)
  } catch (e) {
    console.error('Max retry tries has been reached: ', e)
    process.exit(1)
  }
}
