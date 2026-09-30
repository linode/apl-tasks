import { ResponseError } from '@linode/keycloak-client-fetch'

export class WrappedError extends Error {}

export async function extractError(operationName: string, error: Error): Promise<WrappedError> {
  if (error instanceof WrappedError) return error
  let errorDetail: any
  if (error instanceof ResponseError) {
    const responseStr = await error.response.text().catch(() => '')
    errorDetail = `status code: ${error.response.status} - response: ${responseStr}`
  } else {
    errorDetail = error
  }
  console.error(`Error in ${operationName}:`, errorDetail)
  return new WrappedError(errorDetail)
}
