export interface HarborConfig {
  harborBaseRepoUrl: string
  harborUser: string
  harborPassword: string
  oidcClientId: string
  oidcClientSecret: string
  oidcEndpoint: string
  oidcVerifyCert: boolean
  oidcUserClaim: string
  oidcAutoOnboard: boolean
  oidcGroupsClaim: string
  oidcName: string
  oidcScope: string
  teamNamespaces: string[]
}
