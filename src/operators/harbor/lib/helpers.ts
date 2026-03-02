import { warn } from 'console'

export function alreadyExistsError(e): boolean {
  if (e && e.body && e.body.errors && e.body.errors.length > 0) {
    return e.body.errors[0].message.includes('already exists')
  }
  return false
}

export function handleApiError(errors: string[], action: string, e: unknown, statusCodeExists = 409): void {
  const err = e as {
    statusCode?: number
    message?: string
    body?: unknown
  }
  warn(err.body ?? `${String(err)}`)
  if (err.statusCode) {
    if (err.statusCode === statusCodeExists) {
      warn(`${action} > already exists.`)
    } else {
      errors.push(`${action} > HTTP error ${err.statusCode}: ${err.message}`)
    }
  } else {
    errors.push(`${action} > Unknown error: ${err?.message ?? String(err)}`)
  }
}
