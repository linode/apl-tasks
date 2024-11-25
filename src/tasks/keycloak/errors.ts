import { HttpError as K8sHttpError } from '@kubernetes/client-node'
import { HttpError as KeyCloakHttpError } from '@linode/keycloak-client-node'

export class WrappedError extends Error {}

export function extractError(operationName: string, error: Error): WrappedError {
  if (error instanceof WrappedError) return error
  let errorDetail: any
  if (error instanceof KeyCloakHttpError || error instanceof K8sHttpError) {
    let responseStr = typeof error.body === 'object' ? JSON.stringify(error.body) : error.body
    errorDetail = `status code: ${error.statusCode} - response: ${responseStr}`
  } else {
    errorDetail = error
  }
  console.error(`Error in ${operationName}:`, errorDetail)
  return new WrappedError(errorDetail)
}
