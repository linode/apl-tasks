/* eslint-disable no-loop-func */
/* eslint-disable no-await-in-loop */
import retry, { Options } from 'async-retry'
import http, { Agent as AgentHttp } from 'http'
import { Agent } from 'https'
import fetch, { RequestInit } from 'node-fetch'
import { cleanEnv, NODE_EXTRA_CA_CERTS, NODE_TLS_REJECT_UNAUTHORIZED } from './validators'

const env = cleanEnv({
  NODE_TLS_REJECT_UNAUTHORIZED,
  NODE_EXTRA_CA_CERTS,
})

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
    }

const defaultOptions: WaitTillAvailableOptions = {
  factor: 2,
  confirmations: 10,
  retries: 50,
  status: 200,
  minTimeout: 1000,
  maxTimeout: 30000,
}

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const waitTillAvailable = async (url: string, opts?: WaitTillAvailableOptions): Promise<void> => {
  const options: WaitTillAvailableOptions = { ...defaultOptions, ...opts }
  if (env.isDev) {
    options.confirmations = 1
    options.retries = 1
  }
  const fetchOptions: RequestInit = {
    redirect: 'follow',
    agent: url.startsWith('https://')
      ? new Agent({ rejectUnauthorized: env.NODE_TLS_REJECT_UNAUTHORIZED })
      : new AgentHttp(),
    timeout: 5000,
  }

  // we don't trust dns in the cluster and want a lot of confirmations
  // but we don't care about those when we call the cluster from outside
  let confirmations = 0
  do {
    await retry(async (bail, attempt): Promise<void> => {
      try {
        const res = await fetch(url, fetchOptions)
        if (res.status !== options.status) {
          confirmations = 0
          console.warn(`GET ${url} ${res.status} !== ${options.status}`)
          const err = new Error(`Wrong status code: ${res.status}`)
          // if we get a 404 or 503 we know some changes in either nginx or istio might still not be ready
          if (res.status !== 404 && res.status !== 503) {
            // but any other status code that is not the desired one tells us to stop retrying
            // early bail points to errors, so better to know asap
            bail(err)
          } else throw err
        } else {
          confirmations += 1
          console.debug(`${confirmations}/${options.confirmations} success`)
          await sleep(1000)
        }
      } catch (e) {
        // Print system errors like ECONNREFUSED
        confirmations = 0
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
