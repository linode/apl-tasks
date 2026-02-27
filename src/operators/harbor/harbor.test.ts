import { ProjectReq, RobotCreate, RobotCreated } from '@linode/harbor-client-node'
import * as k8s from '../../k8s'
import { __setApiClients, manageHarborProjectsAndRobotAccounts } from './harbor'
import { createRobotAccount, createSystemRobotSecret, ensureRobotAccount } from './lib/managers/harbor-robots'

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
    updateRobot: jest.fn(),
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

  const mockHarborConfig = {
    harborBaseRepoUrl: 'harbor.example.com',
    harborUser: 'admin',
    harborPassword: 'password',
    oidcClientId: '',
    oidcClientSecret: '',
    oidcEndpoint: '',
    oidcVerifyCert: true,
    oidcUserClaim: 'email',
    oidcAutoOnboard: true,
    oidcGroupsClaim: 'groups',
    oidcName: 'keycloak',
    oidcScope: 'openid',
    teamNamespaces: [],
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockK8s.getSecret.mockResolvedValue(null)
    mockK8s.createSecret.mockResolvedValue(undefined)
    mockK8s.replaceSecret.mockResolvedValue(undefined)
    mockK8s.createK8sSecret.mockResolvedValue(undefined)

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

      mockRobotApi.listRobot.mockResolvedValue(mockRobotList)
      mockRobotApi.createRobot.mockRejectedValue(new Error('Robot creation failed'))

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

  describe('createRobotAccount', () => {
    it('should create a robot account successfully', async () => {
      const projectRobot: RobotCreate = {
        name: 'team-demo-pull',
        level: 'project',
        duration: -1,
        description: 'Allow to pull from project container registry',
        disable: false,
        secret: 'some-token',
        permissions: [
          {
            kind: 'project',
            namespace: 'team-demo',
            access: [{ resource: 'repository', action: 'pull' }],
          },
        ],
      }
      const mockRobotCreated: RobotCreated = {
        id: 1,
        name: 'otomi-team-demo-pull',
        secret: 'robot-secret-123',
      }

      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      const result = await createRobotAccount(projectRobot, mockRobotApi as any)

      expect(result).toEqual(mockRobotCreated)
      expect(mockRobotApi.createRobot).toHaveBeenCalledWith(projectRobot)
    })

    it('should throw error if robot creation fails', async () => {
      const projectRobot: RobotCreate = {
        name: 'team-demo-pull',
        level: 'project',
        duration: -1,
        disable: false,
        permissions: [],
      }

      mockRobotApi.createRobot.mockRejectedValue(new Error('Robot creation failed'))

      await expect(createRobotAccount(projectRobot, mockRobotApi as any)).rejects.toThrow('Robot creation failed')
    })
  })

  describe('ensureRobotAccount', () => {
    it('should create K8s secret and pull robot when neither exists', async () => {
      mockK8s.getSecret.mockResolvedValue(null)
      mockRobotApi.listRobot.mockResolvedValue({ body: [] })
      mockRobotApi.createRobot.mockResolvedValue({ body: { id: 1, name: 'otomi-team-demo-pull', secret: 'token' } })

      await ensureRobotAccount('team-demo', 'team-demo', mockHarborConfig as any, mockRobotApi as any, 'pull', 'pull')

      expect(mockK8s.createK8sSecret).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'team-demo',
          name: 'harbor-pullsecret',
          username: 'team-demo-pull',
        }),
      )
      expect(mockRobotApi.createRobot).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'team-demo-pull',
          level: 'project',
          permissions: expect.arrayContaining([
            expect.objectContaining({
              kind: 'project',
              namespace: 'team-demo',
              access: expect.arrayContaining([
                expect.objectContaining({ resource: 'repository', action: 'pull' }),
              ]),
            }),
          ]),
        }),
      )
    })

    it('should use existing token from K8s secret when robot does not exist', async () => {
      const existingSecret = {
        '.dockerconfigjson': JSON.stringify({
          auths: {
            'harbor.example.com': { username: 'team-demo-pull', password: 'existing-token' },
          },
        }),
      }

      mockK8s.getSecret.mockResolvedValue(existingSecret)
      mockRobotApi.listRobot.mockResolvedValue({ body: [] })
      mockRobotApi.createRobot.mockResolvedValue({ body: { id: 1, name: 'otomi-team-demo-pull', secret: 'token' } })

      await ensureRobotAccount('team-demo', 'team-demo', mockHarborConfig as any, mockRobotApi as any, 'pull', 'pull')

      expect(mockK8s.createK8sSecret).not.toHaveBeenCalled()
      expect(mockRobotApi.createRobot).toHaveBeenCalledWith(
        expect.objectContaining({ secret: 'existing-token' }),
      )
    })

    it('should update existing robot token using credentials from K8s secret', async () => {
      const existingSecret = {
        '.dockerconfigjson': JSON.stringify({
          auths: {
            'harbor.example.com': { username: 'team-demo-push', password: 'existing-push-token' },
          },
        }),
      }
      const existingRobot = { id: 42, name: 'otomi-team-demo-push' }

      mockK8s.getSecret.mockResolvedValue(existingSecret)
      mockRobotApi.listRobot.mockResolvedValue({ body: [existingRobot] })
      mockRobotApi.updateRobot.mockResolvedValue({})

      await ensureRobotAccount('team-demo', 'team-demo', mockHarborConfig as any, mockRobotApi as any, 'push', 'push')

      expect(mockRobotApi.updateRobot).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ secret: 'existing-push-token' }),
      )
      expect(mockRobotApi.createRobot).not.toHaveBeenCalled()
    })

    it('should create push robot with push and pull permissions', async () => {
      mockK8s.getSecret.mockResolvedValue(null)
      mockRobotApi.listRobot.mockResolvedValue({ body: [] })
      mockRobotApi.createRobot.mockResolvedValue({ body: { id: 2, name: 'otomi-team-demo-push', secret: 'push-token' } })

      await ensureRobotAccount('team-demo', 'team-demo', mockHarborConfig as any, mockRobotApi as any, 'push', 'push')

      expect(mockRobotApi.createRobot).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'team-demo-push',
          permissions: expect.arrayContaining([
            expect.objectContaining({
              access: expect.arrayContaining([
                expect.objectContaining({ resource: 'repository', action: 'push' }),
                expect.objectContaining({ resource: 'repository', action: 'pull' }),
              ]),
            }),
          ]),
        }),
      )
    })

    it('should create builds robot with push and pull permissions', async () => {
      mockK8s.getSecret.mockResolvedValue(null)
      mockRobotApi.listRobot.mockResolvedValue({ body: [] })
      mockRobotApi.createRobot.mockResolvedValue({
        body: { id: 3, name: 'otomi-team-demo-builds', secret: 'builds-token' },
      })

      await ensureRobotAccount('team-demo', 'team-demo', mockHarborConfig as any, mockRobotApi as any, 'builds', 'push')

      expect(mockRobotApi.createRobot).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'team-demo-builds',
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
  })

  describe('manageHarborProjectsAndRobotAccounts', () => {
    it('should create project, associate team roles, and set up robot accounts', async () => {
      const namespace = 'team-demo'
      const mockProject = { projectId: 1, name: namespace }
      const mockProjectReq: ProjectReq = { projectName: namespace }
      const mockRobotCreated: RobotCreated = {
        id: 1,
        name: 'otomi-team-demo-pull',
        secret: 'robot-secret-123',
      }

      mockProjectsApi.createProject.mockResolvedValue({})
      mockProjectsApi.getProject.mockResolvedValue({ body: mockProject })
      mockMemberApi.createProjectMember.mockResolvedValue({})
      mockRobotApi.listRobot.mockResolvedValue({ body: [] })
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      const result = await manageHarborProjectsAndRobotAccounts(namespace)

      expect(mockProjectsApi.createProject).toHaveBeenCalledWith(mockProjectReq)
      expect(mockProjectsApi.getProject).toHaveBeenCalledWith(namespace)
      expect(mockMemberApi.createProjectMember).toHaveBeenCalledTimes(2)
      expect(result).toBe('1')
    })

    it('should return null if project not found', async () => {
      const namespace = 'team-demo'

      mockProjectsApi.createProject.mockResolvedValue({})
      mockProjectsApi.getProject.mockResolvedValue({ body: null })

      const result = await manageHarborProjectsAndRobotAccounts(namespace)

      expect(result).toBeNull()
    })

    it('should handle project creation errors gracefully', async () => {
      const namespace = 'team-demo'

      mockProjectsApi.createProject.mockRejectedValue(new Error('Project creation failed'))
      mockProjectsApi.getProject.mockResolvedValue({ body: null })

      const result = await manageHarborProjectsAndRobotAccounts(namespace)

      expect(result).toBe(null)
    })

    it('should handle project member creation errors gracefully', async () => {
      const namespace = 'team-demo'
      const mockProject = { projectId: 1, name: namespace }
      const mockRobotCreated: RobotCreated = {
        id: 1,
        name: 'otomi-team-demo-pull',
        secret: 'robot-secret-123',
      }

      mockProjectsApi.createProject.mockResolvedValue({})
      mockProjectsApi.getProject.mockResolvedValue({ body: mockProject })
      mockMemberApi.createProjectMember.mockRejectedValue(new Error('Member creation failed'))
      mockRobotApi.listRobot.mockResolvedValue({ body: [] })
      mockRobotApi.createRobot.mockResolvedValue({ body: mockRobotCreated })

      const result = await manageHarborProjectsAndRobotAccounts(namespace)

      expect(mockMemberApi.createProjectMember).toHaveBeenCalled()
      expect(result).toBe('1')
    })

    it('should return null on errors during robot account setup', async () => {
      const namespace = 'team-demo'
      const mockProject = { projectId: 1, name: namespace }

      mockProjectsApi.createProject.mockResolvedValue({})
      mockProjectsApi.getProject.mockResolvedValue({ body: mockProject })
      mockMemberApi.createProjectMember.mockResolvedValue({})
      mockRobotApi.listRobot.mockRejectedValue(new Error('Robot API error'))

      const result = await manageHarborProjectsAndRobotAccounts(namespace)

      expect(result).toBeNull()
    })
  })

  describe('error handling', () => {
    it('should handle API authentication errors', async () => {
      mockRobotApi.listRobot.mockRejectedValue(new Error('Authentication failed'))

      await expect(createSystemRobotSecret(mockRobotApi as any, 'system-robot', 'harbor-system')).rejects.toThrow(
        'Authentication failed',
      )
    })

    it('should handle network errors', async () => {
      mockRobotApi.listRobot.mockRejectedValue(new Error('Network error'))

      await expect(createSystemRobotSecret(mockRobotApi as any, 'system-robot', 'harbor-system')).rejects.toThrow(
        'Network error',
      )
    })

    it('should handle Harbor API rate limiting', async () => {
      mockRobotApi.listRobot.mockResolvedValue({ body: [] })
      mockRobotApi.createRobot.mockRejectedValue(new Error('Rate limit exceeded'))

      await expect(createSystemRobotSecret(mockRobotApi as any, 'system-robot', 'harbor-system')).rejects.toThrow(
        'Rate limit exceeded',
      )
    })
  })

  describe('resource cleanup', () => {
    it('should handle updateRobot failure without throwing', async () => {
      const existingSecret = {
        '.dockerconfigjson': JSON.stringify({
          auths: {
            'harbor.example.com': { username: 'team-demo-pull', password: 'existing-token' },
          },
        }),
      }
      const existingRobot = { id: 99, name: 'otomi-team-demo-pull' }

      mockK8s.getSecret.mockResolvedValue(existingSecret)
      mockRobotApi.listRobot.mockResolvedValue({ body: [existingRobot] })
      mockRobotApi.updateRobot.mockRejectedValue(new Error('Update failed'))

      // Should not throw — updateRobotToken catches errors internally
      await expect(
        ensureRobotAccount('team-demo', 'team-demo', mockHarborConfig as any, mockRobotApi as any, 'pull', 'pull'),
      ).resolves.toBeUndefined()

      expect(mockRobotApi.updateRobot).toHaveBeenCalledWith(99, expect.objectContaining({ secret: 'existing-token' }))
    })
  })
})
