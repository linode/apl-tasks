import { ResponseError } from '@linode/harbor-client-fetch'
import { error, warn } from 'console'

export function alreadyExistsError(e: unknown): boolean {
  return e instanceof ResponseError && e.response.status === 409
}

export function notFoundError(e: unknown): boolean {
  return e instanceof ResponseError && e.response.status === 404
}

export function handleErrors(errors: string[]): void {
  if (errors.length) {
    error(`Errors found: ${JSON.stringify(errors, null, 2)}`)
    errors.splice(0, errors.length)
  }
}

export function handleApiError(errors: string[], action: string, e: unknown, statusCodeExists = 409): void {
  warn(`${String(e)}`)
  if (e instanceof ResponseError) {
    const { status } = e.response
    if (status === statusCodeExists) {
      warn(`${action} > already exists.`)
    } else {
      errors.push(`${action} > HTTP error ${status}: ${e.message}`)
    }
  } else {
    const err = e as { message?: string }
    errors.push(`${action} > Unknown error: ${err?.message ?? String(e)}`)
  }
}
