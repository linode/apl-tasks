import retry, { Options } from 'async-retry'
import http from 'http'
import { set } from 'lodash'
import { cleanEnv, NODE_EXTRA_CA_CERTS, NODE_TLS_REJECT_UNAUTHORIZED } from './validators'

// Use Node’s native fetch from Node 18+; no import needed.
// If you need types, ensure you have the latest @types/node installed
// which provides global fetch definitions for Node 18+.

const env = cleanEnv({
  NODE_TLS_REJECT_UNAUTHORIZED,
  NODE_EXTRA_CA_CERTS,
})

export function objectToArray(obj: any, keyName: string, keyValue: string): any[] {
  return Object.keys(obj).map((key) => {
    const tmp: Record<string, unknown> = {}
    tmp[keyName] = key
    tmp[keyValue] = obj[key]
    return tmp
  })
}

export function isArrayDifferent(arr: any[], ref: any[]): boolean {
  if (!ref) return arr.length === 0
  if (arr.length !== ref.length) return true
  if (arr.length === 0) return false
  return !arr.every((item) => ref.includes(item))
}

export function emailTransformer(email: string): string {
  return email.replace(/@/g, '-').replace(/\./g, '-')
}

export function isObjectSubsetDifferent(obj: any, ref: any): boolean {
  return !Object.entries(obj).every(([key, value]) => {
    const refValue = ref?.[key]
    if (Array.isArray(value)) {
      if (isArrayDifferent(value, refValue)) return false
    } else if (typeof value === 'object') {
      if (isObjectSubsetDifferent(value, refValue)) return false
    } else if (obj !== undefined && refValue === undefined) {
      return false
    } else if (refValue !== value) return false
    return true
  })
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
  } catch (e: any) {
    // e might not always have the same shape that node-fetch had; adapt as needed:
    console.warn(e.body ?? `${String(e)}`)
    if (e.statusCode) {
      if (e.statusCode === statusCodeExists) {
        console.warn(`${action} > already exists.`)
      } else {
        errors.push(`${action} > HTTP error ${e.statusCode}: ${e.message}`)
      }
    } else {
      errors.push(`${action} > Unknown error: ${e.message}`)
    }
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

type WaitTillAvailableOptions = Options & {
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

const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const waitTillAvailable = async (url: string, host?: string, opts?: WaitTillAvailableOptions): Promise<void> => {
  const options: WaitTillAvailableOptions = { ...defaultOptions, ...opts }
  if (env.isDev) {
    options.confirmations = 1
    options.retries = 1
  }

  // Prepare fetch options
  // NOTE: Native fetch does not allow a custom 'agent' or direct 'timeout'.
  // If you need special TLS handling, rely on environment variables
  // like NODE_TLS_REJECT_UNAUTHORIZED or NODE_EXTRA_CA_CERTS.
  const fetchOptions: RequestInit = {
    redirect: 'follow',
    // If you need a custom Host header:
    // headers: host ? { host } : undefined,
  }

  if (host) {
    set(fetchOptions, 'headers.host', host)
  }

  let confirmations = 0
  while (options.confirmations && confirmations < options.confirmations) {
    await retry(async (bail, attempt): Promise<void> => {
      // Implement a manual timeout with AbortController
      const controller = new AbortController()
      const id = setTimeout(() => controller.abort(), 5000)
      fetchOptions.signal = controller.signal

      try {
        const res = await fetch(url, fetchOptions)
        if (res.status !== options.status) {
          confirmations = 0
          console.warn(`GET ${url} ${res.status} !== ${options.status}`)
          const err = new Error(`Wrong status code: ${res.status}`)

          // If we get a 404 or 503, it might be due to slow provisioning/rollout.
          if (res.status !== 404 && res.status !== 503) {
            // For other status codes, bail out early.
            bail(err)
          } else {
            throw err
          }
        } else {
          confirmations += 1
          console.debug(`${confirmations}/${options.confirmations} success`)
          await sleep(1000)
        }
      } catch (e: any) {
        confirmations = 0
        console.error(`Error in try #${attempt}: `, e.message)

        // If we’ve exhausted all retries, bail out
        if (options.retries !== 0 && attempt === options.retries!) {
          bail(new Error(`Max retries (${options.retries}) has been reached!`))
        } else {
          throw e
        }
      } finally {
        clearTimeout(id)
      }
    }, options)
  }

  console.debug(`Waiting done, ${confirmations}/${options.confirmations} found`)
}

export function getSanitizedErrorMessage(error) {
  return typeof error?.message === 'string' ? error.message.replace(env.giteaPassword, '****') : ''
}
