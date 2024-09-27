/* eslint-disable no-case-declarations */
/* eslint-disable no-param-reassign */
/* eslint-disable no-return-assign */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable no-return-await */
/* eslint-disable no-restricted-syntax */
/* eslint-disable class-methods-use-this */
/* eslint-disable max-classes-per-file */
import * as k8s from '@kubernetes/client-node'
import { KubernetesObject, loadYaml, V1CustomResourceDefinitionVersion, Watch } from '@kubernetes/client-node'
import * as Async from 'async'
import * as FS from 'fs'
import { instance as gaxios, GaxiosOptions, Headers } from 'gaxios'
import * as https from 'https'

// added the type property which was missing in the original KubernetesObject
interface CustomKubernetesObject extends KubernetesObject {
  body: {
    metadata: k8s.V1ObjectMeta
  }
}
/**
 * Logger interface.
 */
export interface OperatorLogger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

class NullLogger implements OperatorLogger {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public debug(message: string): void {
    // no-op
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public info(message: string): void {
    // no-op
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public warn(message: string): void {
    // no-op
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public error(message: string): void {
    // no-op
  }
}

/**
 * The resource event type.
 */
export enum ResourceEventType {
  Added = 'ADDED',
  Modified = 'MODIFIED',
  Deleted = 'DELETED',
}

/**
 * An event on a Kubernetes resource.
 */
export interface ResourceEvent {
  meta: ResourceMeta
  type: ResourceEventType
  object: KubernetesObject
}

/**
 * Some meta information on the resource.
 */
export interface ResourceMeta {
  name: string
  namespace?: string
  id: string
  resourceVersion: string
  apiVersion: string
  kind: string
}

export class ResourceMetaImpl implements ResourceMeta {
  public static createWithId(id: string, object: KubernetesObject): ResourceMeta {
    return new ResourceMetaImpl(id, object)
  }

  public static createWithPlural(plural: string, object: KubernetesObject): ResourceMeta {
    return new ResourceMetaImpl(`${plural}.${object.apiVersion}`, object)
  }

  public id: string

  public name: string

  public namespace?: string

  public resourceVersion: string

  public apiVersion: string

  public kind: string

  private constructor(id: string, object: KubernetesObject) {
    if (!object.metadata?.name || !object.metadata?.resourceVersion || !object.apiVersion || !object.kind) {
      throw Error(`Malformed event object for '${id}'`)
    }
    this.id = id
    this.name = object.metadata.name
    this.namespace = object.metadata.namespace
    this.resourceVersion = object.metadata.resourceVersion
    this.apiVersion = object.apiVersion
    this.kind = object.kind
  }
}

/**
 * Base class for an operator.
 */
export default abstract class Operator {
  protected kubeConfig: k8s.KubeConfig

  protected k8sApi: k8s.CoreV1Api

  protected k8sCustomApi: k8s.CustomObjectsApi

  protected logger: OperatorLogger

  private resourcePathBuilders: Record<string, (meta: ResourceMeta) => string> = {}

  private watchRequests: Record<string, { abort(): void }> = {}

  private eventQueue: Async.QueueObject<{
    event: ResourceEvent
    onEvent: (event: ResourceEvent) => Promise<void>
  }>

  /**
   * Constructs an operator.
   */
  constructor(logger?: OperatorLogger) {
    this.kubeConfig = new k8s.KubeConfig()
    this.kubeConfig.loadFromDefault()
    this.k8sApi = this.kubeConfig.makeApiClient(k8s.CoreV1Api)
    this.logger = logger || new NullLogger()

    // Use an async queue to make sure we treat each incoming event sequentially using async/await
    this.eventQueue = Async.queue<{
      onEvent: (event: ResourceEvent) => Promise<void>
      event: ResourceEvent
    }>(async (args) => await args.onEvent(args.event))
  }

  /**
   * Run the operator, typically called from main().
   */
  public async start(): Promise<void> {
    await this.init()
  }

  public stop(): void {
    for (const req of Object.values(this.watchRequests)) {
      req.abort()
    }
  }

  /**
   * Initialize the operator, add your resource watchers here.
   */
  protected abstract init(): Promise<void>

  /**
   * Register a custom resource defintion.
   * @param crdFile The path to the custom resource definition's YAML file
   */
  protected async registerCustomResourceDefinition(crdFile: string): Promise<{
    group: string
    versions: V1CustomResourceDefinitionVersion[]
    plural: string
  }> {
    const crd: any = loadYaml(FS.readFileSync(crdFile, 'utf8'))
    try {
      const apiVersion = crd.apiVersion as string
      if (!apiVersion || !apiVersion.startsWith('apiextensions.k8s.io/')) {
        throw new Error("Invalid CRD yaml (expected 'apiextensions.k8s.io')")
      }
      await this.kubeConfig.makeApiClient(k8s.ApiextensionsV1Api).createCustomResourceDefinition(crd)
      console.log(`registered custom resource definition '${crd.metadata?.name}'`)
    } catch (err) {
      // API returns a 409 Conflict if CRD already exists.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (err.response?.statusCode !== 409) {
        throw err
      }
    }
    return {
      group: crd.spec.group,
      versions: crd.spec.versions,
      plural: crd.spec.names.plural,
    }
  }

  /**
   * Get uri to the API for your custom resource.
   * @param group The group of the custom resource
   * @param version The version of the custom resource
   * @param plural The plural name of the custom resource
   * @param namespace Optional namespace to include in the uri
   */
  protected getCustomResourceApiUri(group: string, version: string, plural: string, namespace?: string): string {
    let path = group ? `/apis/${group}/${version}/` : `/api/${version}/`
    if (namespace) {
      path += `namespaces/${namespace}/`
    }
    path += plural
    return this.k8sApi.basePath + path
  }

  /**
   * Watch a Kubernetes resource.
   * @param group The group of the resource or an empty string for core resources
   * @param version The version of the resource
   * @param plural The plural name of the resource
   * @param onEvent The async callback for added, modified or deleted events on the resource
   * @param namespace The namespace of the resource (optional)
   */
  protected async watchResource(
    group: string,
    version: string,
    plural: string,
    onEvent: (event: ResourceEvent) => Promise<void>,
    namespace?: string,
  ): Promise<void> {
    const apiVersion = group ? `${group}/${version}` : `${version}`
    const id = `${plural}.${apiVersion}`

    this.resourcePathBuilders[id] = (meta: ResourceMeta): string =>
      this.getCustomResourceApiUri(group, version, plural, meta.namespace)

    //
    // Create "infinite" watch so we automatically recover in case the stream stops or gives an error.
    //
    let uri = group ? `/apis/${group}/${version}/` : `/api/${version}/`
    if (namespace) {
      uri += `namespaces/${namespace}/`
    }
    uri += plural

    const watch = new Watch(this.kubeConfig)
    let lastHandledResourceVersion = ''
    // let lastResourceVersion = ''
    console.log('Last Handled Resource Version: ', lastHandledResourceVersion)
    const startWatch = async (resourceVersion?: string): Promise<void> => {
      console.log('watch: ', watch)
      console.log('Starting watch with resourceVersion: ', resourceVersion)
      console.log('Starting watch on uri: ', uri)
      return watch
        .watch(
          uri,
          resourceVersion ? { resourceVersion } : {},
          async (phase, obj) => {
            console.log('PHASE: ', phase)
            console.log('OBJECT: ', obj)
            if (obj && obj.status !== 'Failure') {
              // Enqueue the event to process it
              this.eventQueue.push({
                event: {
                  meta: ResourceMetaImpl.createWithPlural(plural, obj),
                  object: obj,
                  type: phase as ResourceEventType,
                },
                onEvent,
              })
              lastHandledResourceVersion = obj.metadata.resourceVersion
            } else if (obj && obj.status === 'Failure') {
              console.log(`watch on resource ${id} failed: ${this.errorToJson(obj)}`)
              let filteredList
              switch (plural) {
                case 'secrets':
                  const secretList = await this.k8sApi.listNamespacedSecret(namespace!)
                  secretList.body.items.sort(
                    (a, b) => parseInt(a.metadata!.resourceVersion!, 10) - parseInt(b.metadata!.resourceVersion!, 10),
                  )
                  console.log('SECRETLIST: ', secretList.body.items)
                  filteredList = secretList.body.items.filter((secret) => {
                    const secretResourceVersion = secret.metadata!.resourceVersion!
                    return parseInt(secretResourceVersion, 10) > parseInt(lastHandledResourceVersion, 10)
                  })
                  console.log('FILTEREDSECRETLIST: ', filteredList.body.items)
                  lastHandledResourceVersion = secretList.body.metadata!.resourceVersion!
                  break
                case 'configmaps':
                  const configList = await this.k8sApi.listNamespacedConfigMap(namespace!)
                  configList.body.items.sort(
                    (a, b) => parseInt(a.metadata!.resourceVersion!, 10) - parseInt(b.metadata!.resourceVersion!, 10),
                  )
                  console.log('CONFIGLIST: ', configList.body.items)
                  filteredList = configList.body.items.filter((secret) => {
                    const secretResourceVersion = secret.metadata!.resourceVersion!
                    return parseInt(secretResourceVersion, 10) > parseInt(lastHandledResourceVersion, 10)
                  })
                  console.log('FILTEREDCONFIGLIST: ', filteredList.body.items)
                  lastHandledResourceVersion = configList.body.metadata!.resourceVersion!
                  break
                case 'aplinstalls':
                  const aplinstallsList = await this.k8sCustomApi.listNamespacedCustomObject(
                    group,
                    version,
                    namespace!,
                    plural,
                  )
                  console.log('APLINSTALLSLIST: ', aplinstallsList)
                  // const filteredList = aplinstallsList.body.items.filter((secret) => {
                  //   const secretResourceVersion = secret.metadata!.resourceVersion!
                  //   return parseInt(secretResourceVersion, 10) > parseInt(lastResourceVersion, 10)
                  // })
                  lastHandledResourceVersion = 'aplinstallsList.body.metadata.resourceVersion'
                  break
                default:
                  break
              }
              filteredList.forEach(async (item) => {
                await onEvent({
                  meta: ResourceMetaImpl.createWithPlural(plural, item),
                  object: item,
                  type: ResourceEventType.Modified,
                })
              })
              console.log(`restarting watch on resource ${id} using resourceVersion=${lastHandledResourceVersion}`)
              setTimeout(() => startWatch(lastHandledResourceVersion), 200)
            } else {
              console.log('Received undefined or invalid object:', obj)
            }
          },
          (err) => {
            console.log('Watcher error callback hit')
            if (err) {
              console.log('Error during watch: ', err)
              if (err.code === 410) {
                console.log('ResourceVersion expired, falling back to list and start a new watch')
              } else {
                console.log(`watch on resource ${id} failed: ${this.errorToJson(err)}`)
                console.log(`restarting watch on resource ${id} using resourceVersion=${lastHandledResourceVersion}`)
                setTimeout(() => startWatch(lastHandledResourceVersion), 200)
              }
            }
          },
        )
        .catch((reason) => {
          console.log('Caught an error in watch:', reason)
        })
        .then((req) => {
          if (!req) {
            console.log('Watch request did not return a valid request object')
          } else {
            console.log('Watch request initiated')
            this.watchRequests[id] = req
          }
        })
    }

    try {
      await startWatch()
    } catch (error) {
      console.log('ERROR OCCURED DURING STARTWATCH: ', error)
    }

    console.log(`watching resource ${id}`)
  }

  /**
   * Set the status subresource of a custom resource (if it has one defined).
   * @param meta The resource to update
   * @param status The status body to set
   */
  protected async setResourceStatus(meta: ResourceMeta, status: unknown): Promise<ResourceMeta | null> {
    return await this.resourceStatusRequest('PUT', meta, status)
  }

  /**
   * Patch the status subresource of a custom resource (if it has one defined).
   * @param meta The resource to update
   * @param status The status body to set in JSON Merge Patch format (https://tools.ietf.org/html/rfc7386)
   */
  protected async patchResourceStatus(meta: ResourceMeta, status: unknown): Promise<ResourceMeta | null> {
    return await this.resourceStatusRequest('PATCH', meta, status)
  }

  /**
   * Handle deletion of resource using a unique finalizer. Call this when you receive an added or modified event.
   *
   * If the resource doesn't have the finalizer set yet, it will be added. If the finalizer is set and the resource
   * is marked for deletion by Kubernetes your 'deleteAction' action will be called and the finalizer will be removed.
   * @param event The added or modified event.
   * @param finalizer Your unique finalizer string
   * @param deleteAction An async action that will be called before your resource is deleted.
   * @returns True if no further action is needed, false if you still need to process the added or modified event yourself.
   */
  protected async handleResourceFinalizer(
    event: ResourceEvent,
    finalizer: string,
    deleteAction: (event: ResourceEvent) => Promise<void>,
  ): Promise<boolean> {
    const { metadata } = event.object
    if (!metadata || (event.type !== ResourceEventType.Added && event.type !== ResourceEventType.Modified)) {
      return false
    }
    if (!metadata.deletionTimestamp && (!metadata.finalizers || !metadata.finalizers.includes(finalizer))) {
      // Make sure our finalizer is added when the resource is first created.
      const finalizers = metadata.finalizers ?? []
      finalizers.push(finalizer)
      await this.setResourceFinalizers(event.meta, finalizers)
      return true
    }
    if (metadata.deletionTimestamp) {
      if (metadata.finalizers && metadata.finalizers.includes(finalizer)) {
        // Resource is marked for deletion with our finalizer still set. So run the delete action
        // and clear the finalizer, so the resource will actually be deleted by Kubernetes.
        await deleteAction(event)
        const finalizers = metadata.finalizers.filter((f) => f !== finalizer)
        await this.setResourceFinalizers(event.meta, finalizers)
      }
      // Resource is marked for deletion, so don't process it further.
      return true
    }
    return false
  }

  /**
   * Set (or clear) the finalizers of a resource.
   * @param meta The resource to update
   * @param finalizers The array of finalizers for this resource
   */
  protected async setResourceFinalizers(meta: ResourceMeta, finalizers: string[]): Promise<void> {
    const options: GaxiosOptions = {
      method: 'PATCH',
      url: `${this.resourcePathBuilders[meta.id](meta)}/${meta.name}`,
      data: {
        metadata: {
          finalizers,
        },
      },
      headers: {
        'Content-Type': 'application/merge-patch+json',
      },
    }

    await this.applyGaxiosKubeConfigAuth(options)

    await gaxios.request(options).catch((error) => {
      if (error) {
        console.log(this.errorToJson(error))
      }
    })
  }

  /**
   * Apply authentication to an axios request config.
   * @param request the axios request config
   */
  protected async applyAxiosKubeConfigAuth(request: {
    headers?: Record<string, string | number | boolean>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    httpsAgent?: any
    auth?: { username: string; password: string }
  }): Promise<void> {
    const opts: https.RequestOptions = {}
    await this.kubeConfig.applytoHTTPSOptions(opts)
    if (opts.headers?.Authorization) {
      request.headers = request.headers ?? {}
      request.headers.Authorization = opts.headers.Authorization as string
    }
    if (opts.auth) {
      const userPassword = opts.auth.split(':')
      request.auth = {
        username: userPassword[0],
        password: userPassword[1],
      }
    }
    if (opts.ca || opts.cert || opts.key) {
      request.httpsAgent = new https.Agent({
        ca: opts.ca,
        cert: opts.cert,
        key: opts.key,
      })
    }
  }

  /**
   * Apply authentication to an axios request config.
   * @param options the axios request config
   */
  protected async applyGaxiosKubeConfigAuth(options: {
    headers?: Headers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agent?: any
  }): Promise<void> {
    const opts: https.RequestOptions = {}
    await this.kubeConfig.applytoHTTPSOptions(opts)
    if (opts.headers?.Authorization) {
      options.headers = options.headers ?? {}
      options.headers.Authorization = opts.headers.Authorization as string
    } else if (opts.auth) {
      options.headers = options.headers ?? {}
      options.headers.Authorization = `Basic ${Buffer.from(opts.auth).toString('base64')}`
    }
    if (opts.ca || opts.cert || opts.key) {
      options.agent = new https.Agent({
        ca: opts.ca,
        cert: opts.cert,
        key: opts.key,
      })
    }
  }

  private async resourceStatusRequest(
    method: 'PUT' | 'PATCH',
    meta: ResourceMeta,
    status: unknown,
  ): Promise<ResourceMeta | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = {
      apiVersion: meta.apiVersion,
      kind: meta.kind,
      metadata: {
        name: meta.name,
        resourceVersion: meta.resourceVersion,
      },
      status,
    }
    if (meta.namespace) {
      body.metadata.namespace = meta.namespace
    }
    const options: GaxiosOptions = {
      method,
      url: `${this.resourcePathBuilders[meta.id](meta)}/${meta.name}/status`,
      data: body,
    }
    if (method === 'PATCH') {
      options.headers = {
        'Content-Type': 'application/merge-patch+json',
      }
    }
    await this.applyGaxiosKubeConfigAuth(options)
    try {
      const response = await gaxios.request<KubernetesObject>(options)
      return response ? ResourceMetaImpl.createWithId(meta.id, response.data) : null
    } catch (err) {
      console.log(this.errorToJson(err))
      return null
    }
  }

  private errorToJson(err: unknown): string {
    if (typeof err === 'string') {
      return err
    }
    if ((err as Error)?.message && (err as Error).stack) {
      return JSON.stringify(err, ['name', 'message', 'stack'])
    }
    return JSON.stringify(err)
  }
}