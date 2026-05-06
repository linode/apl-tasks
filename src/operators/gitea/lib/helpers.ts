import { ResponseError } from '@linode/gitea-client-fetch'
import { teamNameOwners, teamNameViewer } from '../../common'
import { PipelineKubernetesObject } from './types/webhook'
import { k8s } from '../../../k8s'

export function isUnprocessableError(error): boolean {
  return error instanceof ResponseError && error.response.status === 422
}

export function isNotFoundError(error): boolean {
  return error instanceof ResponseError && error.response.status === 404
}

export function isNotModifiedError(error) {
  return error instanceof ResponseError && error.response.status === 304
}

// Set Gitea Functions
// Exported for testing purposes
export function buildTeamString(teamNames: any[]): string {
  const teamObject: groupMapping = { 'platform-admin': { otomi: [teamNameOwners] } }
  if (teamNames === undefined) return JSON.stringify(teamObject)
  teamNames.forEach((teamName: string) => {
    const team = `team-${teamName}`
    teamObject[team] = {
      otomi: [teamNameViewer, team],
      [team]: ['Owners'],
    }
  })
  return JSON.stringify(teamObject)
}

interface groupMapping {
  [key: string]: {
    [teamId: string]: string[]
  }
}

export async function getTektonPipeline(
  pipelineName: string,
  namespace: string,
): Promise<PipelineKubernetesObject | undefined> {
  try {
    const pipeline = await k8s.customObjectsApi().getNamespacedCustomObject({
      group: 'tekton.dev',
      version: 'v1',
      namespace,
      plural: 'pipelines',
      name: pipelineName,
    })
    return pipeline as PipelineKubernetesObject
  } catch (error) {
    console.error(`Problem getting the pipeline: ${error}`)
  }
}
