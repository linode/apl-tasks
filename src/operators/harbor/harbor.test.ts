import {
  createSystemRobotSecret,
  createTeamPullRobotAccount,
  ensureTeamBuildsPushRobotAccount,
  ensureTeamPushRobotAccount,
} from './lib/managers/harbor-robots'
import { ProjectReq, RobotCreated } from '@linode/harbor-client-node'
import * as k8s from '../../k8s'
import { __setApiClients, processNamespace } from './harbor'

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: jest.fn().mockImplementation(() => ({
    loadFromDefault: jest.fn(),
    loadFromFile: jest.fn(),
    makeApiClient: jest.fn().mockReturnValue({
      createNamespacedSecret: jest.fn(),
      readNamespacedSecret: jest.fn(),
      replaceNamespacedSecret: jest.fn(),
      deleteNamespacedSecret: jest.fn(),
    }),
  })),
  CoreV1Api: jest.fn(),
  CustomObjectsApi: jest.fn(),
  V1Secret: jest.fn(),
  V1ObjectMeta: jest.fn(),
}))

jest.mock('../../k8s')

jest.mock('../../utils', () => ({
  ...jest.requireActual('../../utils'),
  waitTillAvailable: jest.fn().mockResolvedValue(undefined),
  handleErrors: jest.fn(),
}))

jest.mock('../../validators', () => ({
  ...jest.requireActual('../../validators'),
  cleanEnv: jest.fn(() => ({
    HARBOR_BASE_URL: 'https://harbor.example.com',
    HARBOR_BASE_URL_PORT: '443',
    HARBOR_OPERATOR_NAMESPACE: 'harbor-operator',
    HARBOR_SYSTEM_NAMESPACE: 'harbor-system',
    HARBOR_SYSTEM_ROBOTNAME: 'system-robot',
  })),
}))

jest.mock('./harbor-full-robot-system-permissions.json', () => [
  { resource: 'repository', action: 'pull' },
  { resource: 'repository', action: 'push' },
  { resource: 'artifact', action: 'read' },
  { resource: 'artifact', action: 'create' },
])

jest.mock('./lib/managers/harbor-oidc', () => ({
  manageHarborOidcConfig: jest.fn().mockResolvedValue(undefined),
}))

describe('harborOperator', () => {
  const mockK8s = k8s as jest.Mocked<typeof k8s>

  const mockRobotApi = {
    listRobot: jest.fn(),
    createRobot: jest.fn(),
    deleteRobot: jest.fn(),
    setDefaultAuthentication: jest.fn(),
  }

  const mockConfigureApi = {
    updateConfigurations: jest.fn(),
    setDefaultAuthentication: jest.fn(),
  }

  const mockProjectsApi = {
    createProject: jest.fn(),
    getProject: jest.fn(),
    setDefaultAuthentication: jest.fn(),
  }

  const mockMemberApi = {
    createProjectMember: jest.fn(),
    setDefaultAuthentication: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockK8s.getSecret.mockResolvedValue(null)
    mockK8s.createSecret.mockResolvedValue(undefined)
    mockK8s.replaceSecret.mockResolvedValue(undefined)
    mockK8s.createK8sSecret.mockResolvedValue(undefined)
    mockK8s.createBuildsK8sSecret.mockResolvedValue(undefined)

    __setApiClients(
      mockRobotApi as any,
      mockConfigureApi as any,
      mockProjectsApi as any,
      mockMemberApi as any,
    )
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('createSystemRobotSecret', () => {
    it('should create a system robot secret successfully', async () => {
      const mockRobotList = { body: [] }
      const mockRobotCreated: RobotCreated = {
        id: 1,
        name: 'otomi-system-robot',
        secret: 'robot-secret-123',
      }

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      const result = await createSystemRobotSecret(mockRobotApi as any, 'system-robot', 'harbor-system')

      expect(result).toEqual({
        id: 1,
        name: 'otomi-system-robot',
        secret: 'robot-secret-123',
      })
      expect(mockRobotApi.listRobot).toHaveBeenCalled()
      expect(mockRobotApi.createRobot).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'system-robot',
          level: 'system',
          permissions: expect.arrayContaining([
            expect.objectContaining({
              kind: 'system',
              namespace: '/',
              access: expect.any(Array),
            }),
          ]),
        }),
      )
      expect(mockK8s.createSecret).toHaveBeenCalledWith(
        'harbor-robot-admin',
        'harbor-system',
        expect.objectContaining({
          id: 1,
          name: 'otomi-system-robot',
          secret: 'robot-secret-123',
        }),
      )
    })

    it('should delete existing robot before creating new one', async () => {
      const existingRobot = { id: 999, name: 'otomi-system-robot' }
      const mockRobotList = { body: [existingRobot] }
      const mockRobotCreated: RobotCreated = {
        id: 1,
        name: 'otomi-system-robot',
        secret: 'robot-secret-123',
      }

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.deleteRobot.mockResolvedValue({})
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      const result = await createSystemRobotSecret(mockRobotApi as any, 'system-robot', 'harbor-system')

      expect(mockRobotApi.deleteRobot).toHaveBeenCalledWith(999)
      expect(mockRobotApi.createRobot).toHaveBeenCalled()
      expect(result.id).toBe(1)
      expect(result.name).toBe('otomi-system-robot')
    })

    it('should throw error if robot creation fails', async () => {
      const mockRobotList = { body: [] }
      const error = new Error('Robot creation failed')

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.createRobot.mockRejectedValue(error)

      await expect(createSystemRobotSecret(mockRobotApi as any, 'system-robot', 'harbor-system')).rejects.toThrow(
        'Robot creation failed',
      )
    })

    it('should throw error if robot account is invalid', async () => {
      const mockRobotList = { body: [] }
      const invalidRobot = { not: 'valid' }

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.createRobot.mockResolvedValue({ body: invalidRobot })

      await expect(createSystemRobotSecret(mockRobotApi as any, 'system-robot', 'harbor-system')).rejects.toThrow(
        'Robot account creation failed: missing id, name, or secret',
      )
    })
  })

  describe('createTeamPullRobotAccount', () => {
    it('should create a pull robot account for a project', async () => {
      const projectName = 'team-demo'
      const expectedRobotName = 'otomi-team-demo-pull'
      const mockRobotList = { body: [] }
      const mockRobotCreated: RobotCreated = {
        id: 1,
        name: expectedRobotName,
        secret: 'robot-secret-123',
      }

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      const result = await createTeamPullRobotAccount(projectName, mockRobotApi as any)

      expect(result).toEqual(mockRobotCreated)
      expect(mockRobotApi.listRobot).toHaveBeenCalled()
      expect(mockRobotApi.createRobot).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'team-demo-pull',
          level: 'system',
          permissions: expect.arrayContaining([
            expect.objectContaining({
              kind: 'project',
              namespace: 'team-demo',
              access: expect.arrayContaining([
                expect.objectContaining({
                  resource: 'repository',
                  action: 'pull',
                }),
              ]),
            }),
          ]),
        }),
      )
    })

    it('should delete existing robot before creating new one', async () => {
      const projectName = 'team-demo'
      const expectedRobotName = 'otomi-team-demo-pull'
      const existingRobot = { id: 999, name: expectedRobotName }
      const mockRobotList = { body: [existingRobot] }
      const mockRobotCreated: RobotCreated = {
        id: 1,
        name: expectedRobotName,
        secret: 'robot-secret-123',
      }

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.deleteRobot.mockResolvedValue({})
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      const result = await createTeamPullRobotAccount(projectName, mockRobotApi as any)

      expect(mockRobotApi.deleteRobot).toHaveBeenCalledWith(999)
      expect(mockRobotApi.createRobot).toHaveBeenCalled()
      expect(result.id).toBe(1)
      expect(result.name).toBe(expectedRobotName)
    })

    it('should throw error if robot creation fails', async () => {
      const projectName = 'team-demo'
      const mockRobotList = { body: [] }
      const error = new Error('Robot creation failed')

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.createRobot.mockRejectedValue(error)

      await expect(createTeamPullRobotAccount(projectName, mockRobotApi as any)).rejects.toThrow(
        'Robot creation failed',
      )
    })

    it('should throw error if robot account already exists with more than 100 robots', async () => {
      const projectName = 'team-demo'
      const mockRobotList = { body: [] }
      const mockRobotCreated = { id: undefined, name: 'otomi-team-demo-pull', secret: 'secret' }

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      await expect(createTeamPullRobotAccount(projectName, mockRobotApi as any)).rejects.toThrow(
        'RobotPullAccount already exists and should have been deleted beforehand. This happens when more than 100 robot accounts exist.',
      )
    })
  })

  describe('ensureTeamPushRobotAccount', () => {
    it('should create a push robot account for a project', async () => {
      const projectName = 'team-demo'
      const expectedRobotName = 'otomi-team-demo-push'
      const mockRobotList = { body: [] }
      const mockRobotCreated: RobotCreated = {
        id: 2,
        name: expectedRobotName,
        secret: 'robot-secret-456',
      }

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      const result = await ensureTeamPushRobotAccount(projectName, mockRobotApi as any)

      expect(result).toEqual(mockRobotCreated)
      expect(mockRobotApi.createRobot).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'team-demo-push',
          level: 'system',
          permissions: expect.arrayContaining([
            expect.objectContaining({
              kind: 'project',
              namespace: 'team-demo',
              access: expect.arrayContaining([
                expect.objectContaining({ resource: 'repository', action: 'push' }),
                expect.objectContaining({ resource: 'repository', action: 'pull' }),
              ]),
            }),
          ]),
        }),
      )
    })

    it('should delete existing robot before creating new one', async () => {
      const projectName = 'team-demo'
      const expectedRobotName = 'otomi-team-demo-push'
      const existingRobot = { id: 999, name: expectedRobotName }
      const mockRobotList = { body: [existingRobot] }
      const mockRobotCreated: RobotCreated = {
        id: 2,
        name: expectedRobotName,
        secret: 'robot-secret-456',
      }

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.deleteRobot.mockResolvedValue({})
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      const result = await ensureTeamPushRobotAccount(projectName, mockRobotApi as any)

      expect(mockRobotApi.deleteRobot).toHaveBeenCalledWith(999)
      expect(result.id).toBe(2)
    })

    it('should throw error if robot account already exists with more than 100 robots', async () => {
      const projectName = 'team-demo'
      const mockRobotList = { body: [] }
      const mockRobotCreated = { id: undefined, name: 'otomi-team-demo-push', secret: 'secret' }

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      await expect(ensureTeamPushRobotAccount(projectName, mockRobotApi as any)).rejects.toThrow(
        'RobotPushAccount already exists and should have been deleted beforehand. This happens when more than 100 robot accounts exist.',
      )
    })
  })

  describe('ensureTeamBuildsPushRobotAccount', () => {
    it('should create a builds push robot account for a project', async () => {
      const projectName = 'team-demo'
      const expectedRobotName = 'otomi-team-demo-builds'
      const mockRobotList = { body: [] }
      const mockRobotCreated: RobotCreated = {
        id: 3,
        name: expectedRobotName,
        secret: 'robot-secret-789',
      }

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      const result = await ensureTeamBuildsPushRobotAccount(projectName, mockRobotApi as any)

      expect(result).toEqual(mockRobotCreated)
      expect(mockRobotApi.createRobot).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'team-demo-builds',
          level: 'system',
          permissions: expect.arrayContaining([
            expect.objectContaining({
              kind: 'project',
              namespace: 'team-demo',
              access: expect.arrayContaining([
                expect.objectContaining({ resource: 'repository', action: 'push' }),
                expect.objectContaining({ resource: 'repository', action: 'pull' }),
              ]),
            }),
          ]),
        }),
      )
    })

    it('should throw error if robot account already exists with more than 100 robots', async () => {
      const projectName = 'team-demo'
      const mockRobotList = { body: [] }
      const mockRobotCreated = { id: undefined, name: 'otomi-team-demo-builds', secret: 'secret' }

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      await expect(ensureTeamBuildsPushRobotAccount(projectName, mockRobotApi as any)).rejects.toThrow(
        'RobotBuildsPushAccount already exists and should have been deleted beforehand. This happens when more than 100 robot accounts exist.',
      )
    })
  })

  describe('processNamespace', () => {
    it('should create project and associate team roles', async () => {
      const namespace = 'team-demo'
      const mockProject = { projectId: 1, name: namespace }
      const mockProjectReq: ProjectReq = { projectName: namespace }

      mockProjectsApi.createProject.mockResolvedValue({})
      mockProjectsApi.getProject.mockResolvedValue({ body: mockProject })
      mockMemberApi.createProjectMember.mockResolvedValue({})

      const mockRobotCreated: RobotCreated = {
        id: 1,
        name: 'otomi-team-demo-pull',
        secret: 'robot-secret-123',
      }
      mockRobotApi.listRobot.mockResolvedValue({ body: [] })
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      const result = await processNamespace(namespace)

      expect(mockProjectsApi.createProject).toHaveBeenCalledWith(mockProjectReq)
      expect(mockProjectsApi.getProject).toHaveBeenCalledWith(namespace)
      expect(mockMemberApi.createProjectMember).toHaveBeenCalledTimes(2)
      expect(result).toBeNull()
    })

    it('should return empty string if project not found', async () => {
      const namespace = 'team-demo'

      mockProjectsApi.createProject.mockResolvedValue({})
      mockProjectsApi.getProject.mockResolvedValue({ body: null })

      const result = await processNamespace(namespace)

      expect(result).toBe('')
    })

    it('should handle project creation errors gracefully', async () => {
      const namespace = 'team-demo'
      const error = new Error('Project creation failed')

      mockProjectsApi.createProject.mockRejectedValue(error)
      mockProjectsApi.getProject.mockResolvedValue({ body: null })

      const result = await processNamespace(namespace)

      expect(result).toBe('')
    })

    it('should handle project member creation errors gracefully', async () => {
      const namespace = 'team-demo'
      const mockProject = { projectId: 1, name: namespace }
      const memberError = new Error('Member creation failed')

      mockProjectsApi.createProject.mockResolvedValue({})
      mockProjectsApi.getProject.mockResolvedValue({ body: mockProject })
      mockMemberApi.createProjectMember.mockRejectedValue(memberError)

      const mockRobotCreated: RobotCreated = {
        id: 1,
        name: 'otomi-team-demo-pull',
        secret: 'robot-secret-123',
      }
      mockRobotApi.listRobot.mockResolvedValue({ body: [] })
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      const result = await processNamespace(namespace)

      expect(mockMemberApi.createProjectMember).toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('should handle general errors and return null', async () => {
      const namespace = 'team-demo'
      const mockProject = { projectId: 1, name: namespace }
      const error = new Error('Robot creation error')

      mockProjectsApi.createProject.mockResolvedValue({})
      mockProjectsApi.getProject.mockResolvedValue({ body: mockProject })
      mockMemberApi.createProjectMember.mockResolvedValue({})

      mockRobotApi.listRobot.mockRejectedValue(error)

      const result = await processNamespace(namespace)

      expect(result).toBeNull()
    })
  })

  describe('error handling', () => {
    it('should handle API authentication errors', async () => {
      const authError = new Error('Authentication failed')
      mockRobotApi.listRobot.mockRejectedValue(authError)

      await expect(createSystemRobotSecret(mockRobotApi as any, 'system-robot', 'harbor-system')).rejects.toThrow(
        'Authentication failed',
      )
    })

    it('should handle network errors', async () => {
      const networkError = new Error('Network error')
      mockRobotApi.listRobot.mockRejectedValue(networkError)

      await expect(createSystemRobotSecret(mockRobotApi as any, 'system-robot', 'harbor-system')).rejects.toThrow(
        'Network error',
      )
    })

    it('should handle Harbor API rate limiting', async () => {
      const rateLimitError = new Error('Rate limit exceeded')
      mockRobotApi.createRobot.mockRejectedValue(rateLimitError)
      mockRobotApi.listRobot.mockResolvedValue({ body: [] })

      await expect(createSystemRobotSecret(mockRobotApi as any, 'system-robot', 'harbor-system')).rejects.toThrow(
        'Rate limit exceeded',
      )
    })
  })

  describe('resource cleanup', () => {
    it('should clean up resources when robot deletion fails', async () => {
      const projectName = 'team-demo'
      const expectedRobotName = 'otomi-team-demo-pull'
      const existingRobot = { id: 999, name: expectedRobotName }
      const mockRobotList = { body: [existingRobot] }
      const deleteError = new Error('Deletion failed')

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.deleteRobot.mockRejectedValue(deleteError)
      mockRobotApi.createRobot.mockResolvedValue({
        body: { id: 1, name: expectedRobotName, secret: 'secret' },
      })

      const result = await createTeamPullRobotAccount(projectName, mockRobotApi as any)

      expect(mockRobotApi.deleteRobot).toHaveBeenCalledWith(999)
      expect(mockRobotApi.createRobot).toHaveBeenCalled()
      expect(result.id).toBe(1)
    })
  })
})
