import { CreateHookOption, CreateHookOptionTypeEnum, EditHookOption, RepositoryApi } from '@linode/gitea-client-fetch'
import { orgName } from '../../../common'
import { isNotFoundError, isNotModifiedError } from '../helpers'
import { errors } from '../globals'
import { hookInfo } from '../types/webhook'
import { getRepoNameFromUrl } from '../../../../gitea-utils'
import { isEmpty } from 'lodash'

export async function addTektonHook(repoApi: RepositoryApi): Promise<void> {
  console.debug('Check for Tekton hook')
  const clusterIP = 'http://el-otomi-tekton-listener.otomi-pipelines.svc.cluster.local:8080'
  const hasTektonHook = await hasSpecificHook(repoApi, 'el-otomi-tekton-listener')
  if (!hasTektonHook.hasHook) {
    console.debug('Tekton Hook needs to be created')
    try {
      console.debug(`Adding hook "tekton" to repo otomi/values`)
      await repoApi.repoCreateHook({
        owner: orgName,
        repo: 'values',
        body: {
          type: CreateHookOptionTypeEnum.Gitea,
          active: true,
          config: {
            url: clusterIP,
            http_method: 'post',
            content_type: 'json',
          },
          events: ['push'],
        },
      })
    } catch (e) {
      if (!isNotModifiedError(e)) {
        errors.push(`Error adding hook "tekton" to repo otomi/values: ${e}`)
      }
    }
  }
}

async function hasSpecificHook(repoApi: RepositoryApi, hookToFind: string): Promise<hookInfo> {
  let hooks: any[]
  try {
    console.debug(`Getting hooks in repo "otomi/values"`)
    hooks = await repoApi.repoListHooks({ owner: orgName, repo: 'values' })
  } catch (e) {
    if (isNotFoundError(e)) {
      errors.push(`Error getting hooks in repo "otomi/values": ${e}`)
    }
    console.debug(`No hooks were found in repo "otomi/values"`)
    return { hasHook: false }
  }
  if (!hooks) {
    console.debug(`No hooks were found in repo "otomi/values"`)
    return { hasHook: false }
  }

  const foundHook = hooks.find((hook) => {
    return hook.config && hook.config.url.includes(hookToFind)
  })
  if (foundHook) {
    console.debug(`Hook (${hookToFind}) exists in repo "values"`)
    return { id: foundHook.id, hasHook: true }
  }
  console.debug(`Hook (${hookToFind}) not found in repo "values"`)
  return { hasHook: false }
}

// Logic to create a webhook for repos in an organization
export async function createBuildWebHook(
  repoApi: RepositoryApi,
  teamName: string,
  buildWorkspace: { buildName: string; repoUrl: string },
) {
  try {
    const repoName = getRepoNameFromUrl(buildWorkspace.repoUrl)!

    // Check to see if a webhook already exists with the same url and push event
    const webhooks = await repoApi.repoListHooks({ owner: teamName, repo: repoName })
    let webhookExists
    if (!isEmpty(webhooks)) {
      webhookExists = webhooks.find((hook) => {
        return (
          hook.config!.url ===
          `http://el-gitea-webhook-${buildWorkspace.buildName}.${teamName}.svc.cluster.local:8080` &&
          hook.events?.includes('push')
        )
      })
    }

    if (!isEmpty(webhookExists)) return
    const createHookOption: CreateHookOption = {
      active: true,
      type: CreateHookOptionTypeEnum.Gitea,
      events: ['push'],
      config: {
        content_type: 'json',
        url: `http://el-gitea-webhook-${buildWorkspace.buildName}.${teamName}.svc.cluster.local:8080`,
      },
    }
    await repoApi.repoCreateHook({ owner: teamName, repo: repoName, body: createHookOption })
    console.info(`Gitea webhook created for repository: ${repoName} in ${teamName}`)
  } catch (error) {
    throw new Error(`Error creating Gitea webhook`)
  }
}
// Logic to update a webhook for repos in an organization
export async function updateBuildWebHook(
  repoApi: RepositoryApi,
  teamName: string,
  buildWorkspace: { buildName: string; repoUrl: string },
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const repoName = getRepoNameFromUrl(buildWorkspace.repoUrl)!
    const webhooks = await repoApi.repoListHooks({ owner: teamName, repo: repoName })

    if (isEmpty(webhooks)) {
      console.debug(`No webhooks found for ${repoName} in ${teamName}`)
      console.debug('Trying to create one instead...')
      return await createBuildWebHook(repoApi, teamName, buildWorkspace)
    }

    const editHookOption: EditHookOption = {
      active: true,
      events: ['push'],
      config: {
        content_type: 'json',
        url: `http://el-gitea-webhook-${buildWorkspace.buildName}.${teamName}.svc.cluster.local:8080`,
      },
    }
    await Promise.all(
      webhooks.map(async (webhook) => {
        await repoApi.repoEditHook({ owner: teamName, repo: repoName, id: webhook.id!, body: editHookOption })
      }),
    )
    console.info(`Gitea webhook updated for repository: ${repoName} in ${teamName}`)
  } catch (error) {
    throw new Error('Error updating Gitea webhook')
  }
}

// Logic to delete a webhook for repos in a organization
export async function deleteBuildWebHook(
  repoApi: RepositoryApi,
  teamName: string,
  buildWorkspace: { buildName: string; repoUrl: string },
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const repoName = buildWorkspace.repoUrl.split('/').pop()!
    const webhooks = await repoApi.repoListHooks({ owner: teamName, repo: repoName })

    if (isEmpty(webhooks)) throw new Error(`No webhooks found for ${repoName} in ${teamName}`)

    await Promise.all(
      webhooks.map(async (webhook) => {
        await repoApi.repoDeleteHook({ owner: teamName, repo: repoName, id: webhook.id! })
      }),
    )
    console.info(`Gitea webhook deleted for repository: ${repoName} in ${teamName}`)
  } catch (error) {
    throw new Error('Error deleting Gitea webhook')
  }
}
