import { KubernetesObject } from '@kubernetes/client-node'

export interface hookInfo {
  id?: number
  hasHook: boolean
}

interface Param {
  name: string
  value: string
}
interface Task {
  name: string
  params: Param[]
}

interface PipelineTemplateObject extends KubernetesObject {
  spec: {
    pipelineRef: {
      name: string
    }
  }
}

export interface PipelineKubernetesObject extends KubernetesObject {
  spec: {
    tasks: Task[]
    resourcetemplates: PipelineTemplateObject[]
  }
}
