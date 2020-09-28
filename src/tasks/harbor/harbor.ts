import { Configurations, HttpError, ProductsApi, ProjectReq, ProjectMember } from '@redkubes/harbor-client'
import http from 'http'
import { HttpBasicAuth } from '@kubernetes/client-node'
import {
  cleanEnv,
  HARBOR_BASE_URL,
  HARBOR_PASSWORD,
  HARBOR_USER,
  OIDC_CLIENT_SECRET,
  OIDC_ENDPOINT,
  OIDC_VERIFY_CERT,
  TEAM_NAMES,
} from '../../validators'

const env = cleanEnv({
  HARBOR_BASE_URL,
  HARBOR_PASSWORD,
  HARBOR_USER,
  OIDC_CLIENT_SECRET,
  OIDC_ENDPOINT,
  OIDC_VERIFY_CERT,
  TEAM_NAMES,
})

const HarborRole = {
  admin: 1,
  developer: 2,
  guest: 3,
  master: 4,
}

const HarborGroupType = {
  ldap: 1,
  http: 2,
}

const errors = []

async function doApiCall(
  action: string,
  fn: () => Promise<{
    response: http.IncomingMessage
    body?: any
  }>,
): Promise<{
  response: http.IncomingMessage
  body?: any
}> {
  console.info(`Running '${action}'`)
  try {
    const res = await fn()
    console.log(`Successful '${action}'`)
    return res
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.statusCode === 409) console.warn(`${action}: already exists.`)
      else errors.push(`HTTP error ${e.statusCode}: ${e.message}`)
    } else errors.push(`Error processing '${action}': ${e}`)
  }
}

async function main() {
  const api = new ProductsApi(env.HARBOR_BASE_URL)
  const auth = new HttpBasicAuth()
  auth.username = env.HARBOR_USER
  auth.password = env.HARBOR_PASSWORD
  api.setDefaultAuthentication(auth)

  const config: Configurations = {
    authMode: 'oidc_auth',
    oidcClientId: 'otomi',
    oidcClientSecret: env.OIDC_CLIENT_SECRET,
    oidcEndpoint: env.OIDC_ENDPOINT,
    oidcGroupsClaim: 'groups',
    oidcName: 'otomi',
    oidcScope: 'openid',
    oidcVerifyCert: env.OIDC_VERIFY_CERT,
  }
  await doApiCall('Harbor configuration', async () => {
    return await api.configurationsPut(config)
  })

  for await (const team of env.TEAM_NAMES) {
    const project: ProjectReq = {
      projectName: team,
      metadata: {},
    }
    const res = await doApiCall(`Project for team ${team}`, async () => {
      return await api.projectsPost(project)
    })

    if (!res) continue

    if (!res.response.headers.location) throw Error('Unable to obtain location header from response')
    // E.g.: location: "/api/v2.0/projects/6"
    const projectId = parseInt(res.response.headers.location.split('/').pop())

    const projMember: ProjectMember = {
      roleId: HarborRole.developer,
      memberGroup: {
        groupName: team,
        groupType: HarborGroupType.http,
      },
    }
    const projAdminMember: ProjectMember = {
      roleId: HarborRole.admin,
      memberGroup: {
        groupName: 'team-admin',
        groupType: HarborGroupType.http,
      },
    }
    await doApiCall(`Associating "developer" role for team "${team}" with harbor project "${team}"`, async () => {
      return await api.projectsProjectIdMembersPost(projectId, projMember)
    })
    await doApiCall(`Associating "project-admin" role for "team-admin" with harbor project "${team}"`, async () => {
      return await api.projectsProjectIdMembersPost(projectId, projAdminMember)
    })
  }

  if (errors.length) {
    console.error(`Errors found: ${JSON.stringify(errors, null, 2)}`)
    process.exit(1)
  } else {
    console.info('Success!')
  }
}
main()
