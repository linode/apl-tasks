import { CreateTeamOption, CreateTeamOptionPermissionEnum } from '@linode/gitea-client-fetch'
import { teamNameViewer } from '../../../common'

export const readOnlyTeam: CreateTeamOption = {
  canCreateOrgRepo: false,
  name: teamNameViewer,
  includesAllRepositories: false,
  permission: CreateTeamOptionPermissionEnum.Read,
  units: ['repo.code'],
}
const editorTeam: CreateTeamOption = {
  ...readOnlyTeam,
  includesAllRepositories: false,
  permission: CreateTeamOptionPermissionEnum.Write,
}
export const adminTeam: CreateTeamOption = { ...editorTeam, permission: CreateTeamOptionPermissionEnum.Admin }
