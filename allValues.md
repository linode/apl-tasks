|Parameter|Type|Description|Default|
|-|-|-|-|
| `alerts.drone` | `string` |  | `slack` |
| `alerts.email.critical` | `string` | One or more email addresses (comma separated) for critical events. |  |
| `alerts.email.nonCritical` | `string` | One or more email addresses (comma separated) for non-critical events. |  |
| `alerts.groupInterval` | `string` | How long to wait before sending a notification about new alerts that are added to a group of alerts for which an initial notification has already been sent. (Usually ~5m or more.) | `5m` |
| `alerts.msteams.highPrio` | `string` | The high prio web hook. |  |
| `alerts.msteams.lowPrio` | `string` | The low prio web hook. |  |
| `alerts.receivers.[]` | `string` |  |  |
| `alerts.repeatInterval` | `string` | How long to wait before sending a notification again if it has already been sent successfully for an alert. (Usually ~3h or more). | `3h` |
| `alerts.slack.channel` | `string` | The Slack channel for non-critical notifications. | `mon-otomi` |
| `alerts.slack.channelCrit` | `string` | The Slack channel for critical notifications. | `mon-otomi-crit` |
| `alerts.slack.url` | `string` | A Slack webhook URL. |  |
| `azure.storageType.fast` | `string` |  |  |
| `azure.storageType.standard` | `string` |  |  |
| `azure.appgw.isManaged` | `boolean` | Is this appgw installed as AKS addon? | `true` |
| `azure.monitor.appInsightsApiKey` | `string` | An Azure AppInsights client secret. |  |
| `azure.monitor.appInsightsAppId` | `string` | An Azure client id. |  |
| `azure.monitor.azureLogAnalyticsSameAs` | `boolean` |  | `true` |
| `azure.monitor.clientId` | `string` | An Azure client id. |  |
| `azure.monitor.clientSecret` | `string` | An Azure client secret. |  |
| `azure.monitor.logAnalyticsClientId` | `string` | An Azure client secret. |  |
| `azure.monitor.logAnalyticsClientSecret` | `string` | An Azure client secret. |  |
| `azure.monitor.logAnalyticsTenantId` | `string` | An Azure tenant id. |  |
| `azure.monitor.logAnalyticsDefaultWorkspace` | `string` | An Azure LogAnalytics workspace. |  |
| `azure.monitor.subscriptionId` | `string` | An Azure subscription id. |  |
| `azure.monitor.tenantId` | `string` | An Azure tenant id. |  |
| `cloud.skipStorageClasses.[]` | `string` |  |  |
| `charts.cert-manager.email` | `string` |  |  |
| `charts.cert-manager.stage` | `string` | The Let's Encrypt environment that is used for issuing certificates. The 'production' environment issues trusted certificates but has narrow rate limits, whereas the 'staging' environment issues untrusted certificates but provides broader rate limits. Read more about rate limits: https://letsencrypt.org/docs/rate-limits/.  | `production` |
| `charts.cluster-overprovisioner.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.cluster-overprovisioner.enabled` | `boolean` |  |  |
| `charts.cluster-overprovisioner.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.demo-tlspass.enabled` | `boolean` |  | `false` |
| `charts.demo-tlspass.tlsCert` | `string` |  |  |
| `charts.demo-tlspass.tlsKey` | `string` |  |  |
| `charts.drone.adminIsMachine` | `boolean` |  | `false` |
| `charts.drone.adminUser` | `string` |  |  |
| `charts.drone.adminToken` | `string` |  |  |
| `charts.drone.debug` | `boolean` |  | `false` |
| `charts.drone.enabled` | `boolean` |  | `false` |
| `charts.drone.githubAdmins.org` | `string` |  |  |
| `charts.drone.githubAdmins.team` | `string` |  |  |
| `charts.drone.githubAdmins.token` | `string` |  |  |
| `charts.drone.orgsFilter` | `string` |  |  |
| `charts.drone.owner` | `string` |  |  |
| `charts.drone.repo` | `string` | A lowercase name that starts with a letter and may contain dashes. |  |
| `charts.drone.repoFilter` | `string` |  |  |
| `charts.drone.resources.runner.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.drone.resources.runner.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.drone.resources.runner.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.drone.resources.runner.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.drone.resources.server.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.drone.resources.server.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.drone.resources.server.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.drone.resources.server.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.drone.sharedSecret` | `string` | A secret used by drone-admit-members plugin. https://docs.drone.io/runner/kubernetes/configuration/reference/drone-secret-plugin-token/ |  |
| `charts.drone.sourceControl.bitbucketCloud.clientID` | `string` |  |  |
| `charts.drone.sourceControl.bitbucketCloud.clientSecretValue` | `string` |  |  |
| `charts.drone.sourceControl.bitbucketServer.consumerKey` | `string` |  | `consumerKey` |
| `charts.drone.sourceControl.bitbucketServer.passwordKey` | `string` |  | `password` |
| `charts.drone.sourceControl.bitbucketServer.privateKey` | `string` |  | `privateKey` |
| `charts.drone.sourceControl.bitbucketServer.server` | `string` |  |  |
| `charts.drone.sourceControl.bitbucketServer.username` | `string` |  |  |
| `charts.drone.sourceControl.gitea.clientID` | `string` |  |  |
| `charts.drone.sourceControl.gitea.clientSecretValue` | `string` |  |  |
| `charts.drone.sourceControl.gitea.server` | `string` |  |  |
| `charts.drone.sourceControl.github.clientID` | `string` |  |  |
| `charts.drone.sourceControl.github.clientSecretValue` | `string` |  |  |
| `charts.drone.sourceControl.github.server` | `string` |  | `https://github.com` |
| `charts.drone.sourceControl.gitlab.clientID` | `string` |  |  |
| `charts.drone.sourceControl.gitlab.clientSecretValue` | `string` |  |  |
| `charts.drone.sourceControl.gitlab.server` | `string` |  |  |
| `charts.drone.sourceControl.gogs.server` | `string` |  |  |
| `charts.drone.sourceControl.password` | `string` |  |  |
| `charts.drone.sourceControl.provider` | `string` |  | `github` |
| `charts.drone.sourceControl.secret` | `string` |  |  |
| `charts.drone.sourceControl.username` | `string` |  |  |
| `charts.drone.trace` | `boolean` |  | `false` |
| `charts.external-dns.domainFilters.[]` | `string` |  |  |
| `charts.external-dns.zoneIdFilters.[]` | `string` |  |  |
| `charts.gatekeeper-operator.enabled` | `boolean` |  |  |
| `charts.gatekeeper-operator.excludedNamespaces.[]` | `string` |  |  |
| `charts.gatekeeper-operator.emitAuditEvents` | `boolean` |  |  |
| `charts.gatekeeper-operator.emitAdmissionEvents` | `boolean` |  |  |
| `charts.gatekeeper-operator.auditFromCache` | `boolean` |  |  |
| `charts.gatekeeper-operator.disableValidatingWebhook` | `boolean` |  |  |
| `charts.gatekeeper-operator.logLevel` | `string` |  |  |
| `charts.gatekeeper-operator.constraintViolationsLimit` | `integer` |  |  |
| `charts.gatekeeper-operator.auditInterval` | `integer` |  |  |
| `charts.gatekeeper-operator.replicas` | `integer` |  |  |
| `charts.gitea.enabled` | `boolean` |  |  |
| `charts.gitea.adminPassword` | `string` |  |  |
| `charts.gitea.postgresqlPassword` | `string` | Once set and deployed it cannot be changed with manual intervention. |  |
| `charts.harbor.adminPassword` | `string` |  |  |
| `charts.harbor.core.secret` | `string` |  |  |
| `charts.harbor.core.xsrfKey` | `string` |  |  |
| `charts.harbor.enabled` | `boolean` |  | `true` |
| `charts.harbor.jobservice.secret` | `string` |  |  |
| `charts.harbor.persistence.imageChartStorage.aws.accesskey` | `string` | An AWS access key ID. |  |
| `charts.harbor.persistence.imageChartStorage.aws.secretkey` | `string` | An AWS secret key. |  |
| `charts.harbor.persistence.imageChartStorage.aws.region` | `string` | An AWS region. |  |
| `charts.harbor.persistence.imageChartStorage.aws.regionendpoint` | `string` |  |  |
| `charts.harbor.persistence.imageChartStorage.aws.bucket` | `string` |  |  |
| `charts.harbor.persistence.imageChartStorage.aws.encrypt` | `boolean` |  |  |
| `charts.harbor.persistence.imageChartStorage.aws.keyid` | `string` |  |  |
| `charts.harbor.persistence.imageChartStorage.aws.secure` | `boolean` |  |  |
| `charts.harbor.persistence.imageChartStorage.aws.v4auth` | `boolean` |  |  |
| `charts.harbor.persistence.imageChartStorage.aws.chunksize` | `integer` |  |  |
| `charts.harbor.persistence.imageChartStorage.aws.multipartcopychunksize` | `integer` |  |  |
| `charts.harbor.persistence.imageChartStorage.aws.multipartcopymaxconcurrency` | `integer` |  |  |
| `charts.harbor.persistence.imageChartStorage.aws.multipartcopythresholdsize` | `integer` |  |  |
| `charts.harbor.persistence.imageChartStorage.aws.rootdirectory` | `string` |  |  |
| `charts.harbor.persistence.imageChartStorage.azure.accountname` | `string` |  |  |
| `charts.harbor.persistence.imageChartStorage.azure.accountkey` | `string` |  |  |
| `charts.harbor.persistence.imageChartStorage.azure.container` | `string` |  |  |
| `charts.harbor.persistence.imageChartStorage.azure.realm` | `string` |  |  |
| `charts.harbor.persistence.imageChartStorage.gcs.bucket` | `string` |  |  |
| `charts.harbor.persistence.imageChartStorage.gcs.encodedkey` | `string` |  |  |
| `charts.harbor.persistence.imageChartStorage.gcs.rootdirectory` | `string` |  |  |
| `charts.harbor.persistence.imageChartStorage.type` | `string` |  |  |
| `charts.harbor.registry.secret` | `string` |  |  |
| `charts.harbor.registry.credentials.htpasswd` | `string` |  |  |
| `charts.harbor.registry.credentials.username` | `string` |  |  |
| `charts.harbor.registry.credentials.password` | `string` |  |  |
| `charts.harbor.resources.adapter.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.adapter.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.adapter.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.adapter.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.chartmuseum.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.chartmuseum.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.chartmuseum.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.chartmuseum.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.clair.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.clair.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.clair.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.clair.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.controller.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.controller.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.controller.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.controller.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.core.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.core.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.core.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.core.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.database.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.database.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.database.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.database.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.jobservice.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.jobservice.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.jobservice.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.jobservice.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.portal.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.portal.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.portal.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.portal.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.redis.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.redis.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.redis.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.redis.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.registry.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.registry.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.registry.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.registry.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.registry-controller.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.registry-controller.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.resources.registry-controller.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.harbor.resources.registry-controller.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.harbor.secretKey` | `string` |  |  |
| `charts.hello.enabled` | `boolean` | Hello world demo chart. When you turn this off you may also have to remove the ingress service. | `false` |
| `charts.httpbin.enabled` | `boolean` | The famous httpbin application. | `false` |
| `charts.ingress-azure.enabled` | `boolean` |  |  |
| `charts.ingress-azure.appgw.name` | `string` | A name of the Application Gateway. |  |
| `charts.ingress-azure.appgw.resourceGroup` | `string` | A name of the Azure Resource Group in which Application Gateway was created. |  |
| `charts.ingress-azure.appgw.subnetName` | `string` | A subnet of the application gateway. |  |
| `charts.ingress-azure.appgw.subnetPrefix` | `string` | A subnet in CIDR notation. |  |
| `charts.ingress-azure.appgw.subscriptionId` | `string` | The Azure Subscription ID in which Application Gateway resides. |  |
| `charts.ingress-azure.appgw.usePrivateIP` | `boolean` | Whether a private ip range or not. | `false` |
| `charts.ingress-azure.armAuth.secretJSON` | `string` | A service Principal secret JSON key (base64 encoded). |  |
| `charts.istio.addonComponents.grafana.enabled` | `boolean` |  |  |
| `charts.istio.addonComponents.kiali.enabled` | `boolean` |  |  |
| `charts.istio.addonComponents.prometheus.enabled` | `boolean` |  |  |
| `charts.istio.addonComponents.tracing.enabled` | `boolean` |  |  |
| `charts.istio.autoscaling.egressgateway.maxReplicas` | `integer` |  |  |
| `charts.istio.autoscaling.egressgateway.minReplicas` | `integer` |  |  |
| `charts.istio.autoscaling.gateway-local.maxReplicas` | `integer` |  |  |
| `charts.istio.autoscaling.gateway-local.minReplicas` | `integer` |  |  |
| `charts.istio.autoscaling.ingressgateway.maxReplicas` | `integer` |  |  |
| `charts.istio.autoscaling.ingressgateway.minReplicas` | `integer` |  |  |
| `charts.istio.autoscaling.ingressgateway-auth.maxReplicas` | `integer` |  |  |
| `charts.istio.autoscaling.ingressgateway-auth.minReplicas` | `integer` |  |  |
| `charts.istio.autoscaling.pilot.maxReplicas` | `integer` |  |  |
| `charts.istio.autoscaling.pilot.minReplicas` | `integer` |  |  |
| `charts.istio.egressGateway.enabled` | `boolean` |  | `false` |
| `charts.istio.global.logging.level` | `string` |  |  |
| `charts.istio.global.mtls.enabled` | `boolean` |  |  |
| `charts.istio.global.proxy.resources.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.istio.global.proxy.resources.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.istio.global.proxy.resources.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.istio.global.proxy.resources.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.istio.global.sds.enabled` | `boolean` |  |  |
| `charts.istio.resources.egressgateway.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.istio.resources.egressgateway.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.istio.resources.egressgateway.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.istio.resources.egressgateway.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.istio.resources.gateway-local.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.istio.resources.gateway-local.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.istio.resources.gateway-local.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.istio.resources.gateway-local.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.istio.resources.ingressgateway.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.istio.resources.ingressgateway.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.istio.resources.ingressgateway.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.istio.resources.ingressgateway.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.istio.resources.ingressgateway-auth.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.istio.resources.ingressgateway-auth.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.istio.resources.ingressgateway-auth.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.istio.resources.ingressgateway-auth.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.istio.resources.pilot.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.istio.resources.pilot.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.istio.resources.pilot.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.istio.resources.pilot.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.keycloak.enabled` | `boolean` |  | `true` |
| `charts.keycloak.idp.alias` | `string` |  |  |
| `charts.keycloak.idp.clientID` | `string` |  |  |
| `charts.keycloak.idp.clientSecret` | `string` |  |  |
| `charts.keycloak.postgresqlPassword` | `string` | Once set and deployed it cannot be changed with manual intervention. |  |
| `charts.keycloak.resources.keycloak.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.keycloak.resources.keycloak.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.keycloak.resources.keycloak.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.keycloak.resources.keycloak.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.keycloak.resources.postgresql.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.keycloak.resources.postgresql.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.keycloak.resources.postgresql.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.keycloak.resources.postgresql.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.keycloak.theme` | `string` |  |  |
| `charts.kubeapps.enabled` | `boolean` |  | `true` |
| `charts.kubeapps.postgresqlPassword` | `string` | Once set and deployed it cannot be changed with manual intervention. |  |
| `charts.kubernetes-external-secrets.logLevel` | `string` |  | `info` |
| `charts.kube-descheduler.enabled` | `boolean` |  | `true` |
| `charts.kube-descheduler.schedule` | `string` |  | `*/30 * * * *` |
| `charts.loki.adminPassword` | `string` |  |  |
| `charts.loki.persistence.size` | `string` |  | `20Gi` |
| `charts.loki.retention.duration` | `string` |  | `24h` |
| `charts.loki.retention.period` | `string` | Should be a multiple of 24h. See https://grafana.com/docs/loki/latest/operations/storage/boltdb-shipper/. | `24h` |
| `charts.loki.azure.account_key` | `string` |  |  |
| `charts.loki.azure.account_name` | `string` |  |  |
| `charts.loki.azure.container_name` | `string` |  |  |
| `charts.loki.storageType` | `string` |  |  |
| `charts.loki.v11StartDate` | `string` | Set this to a date just after deployment in case of an upgrade. (Otomi started at v9 with filesystem.) |  |
| `charts.nginx-ingress.autoscaling.enabled` | `boolean` |  | `true` |
| `charts.nginx-ingress.autoscaling.maxReplicas` | `integer` |  | `10` |
| `charts.nginx-ingress.autoscaling.minReplicas` | `integer` |  | `2` |
| `charts.nginx-ingress.loadBalancerIP` | `string` |  |  |
| `charts.nginx-ingress.loadBalancerRG` | `string` |  |  |
| `charts.nginx-ingress.maxBodySize` | `string` |  | `1024m` |
| `charts.nginx-ingress.maxBodySizeBytes` | `integer` | Needed for modsecurity. Should correspond to maxBodySize, but expressed in bytes. | `1073741824` |
| `charts.nginx-ingress.modsecurity.block` | `boolean` | Makes nginx block requests that are marked as violating the modsec rules. | `true` |
| `charts.nginx-ingress.modsecurity.enabled` | `boolean` |  | `false` |
| `charts.nginx-ingress.modsecurity.owasp` | `boolean` | Turns on the default OWASP rule set for modsec. See | `true` |
| `charts.nginx-ingress.resources.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.nginx-ingress.resources.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.nginx-ingress.resources.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.nginx-ingress.resources.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.nginx-ingress.private.enabled` | `boolean` | Enable to start an extra loadbalancer for private network traffic. | `false` |
| `charts.nginx-ingress.private.autoscaling.enabled` | `boolean` |  | `true` |
| `charts.nginx-ingress.private.autoscaling.maxReplicas` | `integer` |  | `10` |
| `charts.nginx-ingress.private.autoscaling.minReplicas` | `integer` |  | `2` |
| `charts.nginx-ingress.private.loadBalancerIP` | `string` |  |  |
| `charts.nginx-ingress.private.loadBalancerRG` | `string` |  |  |
| `charts.nginx-ingress.private.resources.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.nginx-ingress.private.resources.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.nginx-ingress.private.resources.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.nginx-ingress.private.resources.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.nginx-ingress.private.service.annotations.patternProperties.^((([a-zA-Z0-9]\|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]\|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9]){1,253}\/)?([a-z0-9A-Z]+[a-z0-9A-Z-_.]+[a-z0-9A-Z]){1,63}$` | `string` |  |  |
| `charts.nginx-ingress.service.annotations.patternProperties.^((([a-zA-Z0-9]\|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]\|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9]){1,253}\/)?([a-z0-9A-Z]+[a-z0-9A-Z-_.]+[a-z0-9A-Z]){1,63}$` | `string` |  |  |
| `charts.oauth2-proxy.config.cookieSecret` | `string` | Cookie secret must be 128 bit base64 encoded string. |  |
| `charts.oauth2-proxy-redis.architecture` | `string` |  | `standalone` |
| `charts.oauth2-proxy-redis.password` | `string` |  |  |
| `charts.oauth2-proxy-redis.resources.master.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.oauth2-proxy-redis.resources.master.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.oauth2-proxy-redis.resources.master.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.oauth2-proxy-redis.resources.master.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.oauth2-proxy-redis.resources.sentinel.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.oauth2-proxy-redis.resources.sentinel.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.oauth2-proxy-redis.resources.sentinel.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.oauth2-proxy-redis.resources.sentinel.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.oauth2-proxy-redis.resources.slave.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.oauth2-proxy-redis.resources.slave.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.oauth2-proxy-redis.resources.slave.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.oauth2-proxy-redis.resources.slave.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.oauth2-proxy-redis.sizes.master` | `string` | Disk size. Valid units are E\|P\|T\|G\|Ti\|Gi. |  |
| `charts.oauth2-proxy-redis.sizes.sentinel` | `string` | Disk size. Valid units are E\|P\|T\|G\|Ti\|Gi. |  |
| `charts.oauth2-proxy-redis.sizes.slave` | `string` | Disk size. Valid units are E\|P\|T\|G\|Ti\|Gi. |  |
| `charts.otomi-api.git.branch` | `string` |  |  |
| `charts.otomi-api.git.email` | `string` |  |  |
| `charts.otomi-api.git.localPath` | `string` |  |  |
| `charts.otomi-api.git.password` | `string` |  |  |
| `charts.otomi-api.git.repoUrl` | `string` | Path to a remote git repo without protocol. Will use https to access. |  |
| `charts.otomi-api.git.user` | `string` |  |  |
| `charts.otomi-api.image.pullPolicy` | `string` |  | `IfNotPresent` |
| `charts.otomi-api.image.tag` | `string` |  |  |
| `charts.otomi-api.resources.api.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.otomi-api.resources.api.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.otomi-api.resources.api.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.otomi-api.resources.api.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.otomi-api.resources.tools.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.otomi-api.resources.tools.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.otomi-api.resources.tools.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.otomi-api.resources.tools.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.otomi-console.image.pullPolicy` | `string` |  | `IfNotPresent` |
| `charts.otomi-console.image.tag` | `string` |  |  |
| `charts.prometheus-operator.grafana.adminPassword` | `string` |  |  |
| `charts.prometheus-operator.prometheus.retention` | `string` | Prometheus duration (See: https://prometheus.io/docs/prometheus/latest/configuration/configuration/#configuration-file) |  |
| `charts.prometheus-operator.prometheus.storageSize` | `string` | Disk size. Valid units are E\|P\|T\|G\|Ti\|Gi. | `5Gi` |
| `charts.prometheus-operator.resources.grafana.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.prometheus-operator.resources.grafana.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.prometheus-operator.resources.grafana.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.prometheus-operator.resources.grafana.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.redis-shared.architecture` | `string` |  | `standalone` |
| `charts.redis-shared.password` | `string` |  |  |
| `charts.redis-shared.resources.master.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.redis-shared.resources.master.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.redis-shared.resources.master.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.redis-shared.resources.master.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.redis-shared.resources.sentinel.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.redis-shared.resources.sentinel.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.redis-shared.resources.sentinel.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.redis-shared.resources.sentinel.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.redis-shared.resources.slave.limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.redis-shared.resources.slave.limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.redis-shared.resources.slave.requests.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `charts.redis-shared.resources.slave.requests.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `charts.redis-shared.sizes.master` | `string` | Disk size. Valid units are E\|P\|T\|G\|Ti\|Gi. |  |
| `charts.redis-shared.sizes.sentinel` | `string` | Disk size. Valid units are E\|P\|T\|G\|Ti\|Gi. |  |
| `charts.redis-shared.sizes.slave` | `string` | Disk size. Valid units are E\|P\|T\|G\|Ti\|Gi. |  |
| `charts.redis-shared.enabled` | `boolean` |  | `false` |
| `charts.sitespeed.enabled` | `boolean` |  |  |
| `charts.sitespeed.pvc.graphite` | `string` |  |  |
| `charts.sitespeed.pvc.results` | `string` |  |  |
| `charts.sitespeed.retention` | `string` |  |  |
| `charts.sitespeed.schedule` | `string` |  |  |
| `charts.vault.enabled` | `boolean` |  | `true` |
| `charts.vault.logLevel` | `string` |  | `info` |
| `charts.vault.seal.gcpckms.project` | `string` |  |  |
| `charts.vault.seal.gcpckms.region` | `string` |  |  |
| `charts.vault.seal.gcpckms.key_ring` | `string` |  |  |
| `charts.vault.seal.gcpckms.kmsAccount` | `string` |  |  |
| `charts.vault.seal.awskms.region` | `string` |  |  |
| `charts.vault.seal.awskms.access_key` | `string` |  |  |
| `charts.vault.seal.awskms.secret_key` | `string` |  |  |
| `charts.vault.seal.awskms.endpoint` | `string` |  |  |
| `charts.vault.seal.azurekeyvault.vault_name` | `string` |  |  |
| `charts.vault.seal.azurekeyvault.tenant_id` | `string` |  |  |
| `charts.vault.seal.azurekeyvault.client_id` | `string` |  |  |
| `charts.vault.seal.azurekeyvault.client_secret` | `string` |  |  |
| `charts.weave-scope.enabled` | `boolean` |  | `false` |
| `cluster.apiName` | `string` | Only used for API/UI to show in app. |  |
| `cluster.apiServer` | `string` | Used by kubectl for local deployment to target cluster. |  |
| `cluster.domainSuffix` | `string` | Domain suffix for the cluster. Also added to list of dns zones in the Otomi Console. |  |
| `cluster.entrypoint` | `string` | A Kubernetes API public IP address (onprem only). |  |
| `cluster.k8sContext` | `string` | The cluster k8s context as found in $KUBECONFIG. |  |
| `cluster.k8sVersion` | `string` | The cluster k8s version. Otomi supports 2 minor versions backwards compatibility from the suggested default. |  |
| `cluster.name` | `string` |  |  |
| `cluster.owner` | `string` | The name of the organization owning the cluster. |  |
| `cluster.provider` | `string` |  |  |
| `cluster.region` | `string` | Dependent on provider. |  |
| `cluster.vpcID` | `string` | AWS only. If provided will override autodiscovery from metadata. |  |
| `dns.zones.[]` | `string` |  |  |
| `dns.provider.aws.accessKeyID` | `string` | An AWS access key ID. |  |
| `dns.provider.aws.secretAccessKey` | `string` | An AWS secret key. |  |
| `dns.provider.aws.region` | `string` | An AWS region. |  |
| `dns.provider.aws.role` | `string` | Role may be set explicitly if no metadata can be accessed. |  |
| `dns.provider.azure.cloud` | `string` | Azure Cloud |  |
| `dns.provider.azure.resourceGroup` | `string` | Azure resource group |  |
| `dns.provider.azure.hostedZoneName` | `string` |  |  |
| `dns.provider.azure.tenantId` | `string` | Azure tenant ID |  |
| `dns.provider.azure.subscriptionId` | `string` | Azure subscription ID |  |
| `dns.provider.azure.aadClientId` | `string` | Azure Application Client ID |  |
| `dns.provider.azure.aadClientSecret` | `string` | Azure Application Client Secret |  |
| `dns.provider.azure.useManagedIdentityExtension` | `boolean` | If you use Azure MSI, this should be set to true | `false` |
| `dns.provider.google.serviceAccountKey` | `string` | A service account key in json format for managing a DNS zone. |  |
| `dns.provider.google.project` | `string` |  |  |
| `home.drone` | `string` |  | `slack` |
| `home.email.critical` | `string` | One or more email addresses (comma separated) for critical events. |  |
| `home.email.nonCritical` | `string` | One or more email addresses (comma separated) for non-critical events. |  |
| `home.groupInterval` | `string` | How long to wait before sending a notification about new alerts that are added to a group of alerts for which an initial notification has already been sent. (Usually ~5m or more.) | `5m` |
| `home.msteams.highPrio` | `string` | The high prio web hook. |  |
| `home.msteams.lowPrio` | `string` | The low prio web hook. |  |
| `home.receivers.[]` | `string` |  |  |
| `home.repeatInterval` | `string` | How long to wait before sending a notification again if it has already been sent successfully for an alert. (Usually ~3h or more). | `3h` |
| `home.slack.channel` | `string` | The Slack channel for non-critical notifications. | `mon-otomi` |
| `home.slack.channelCrit` | `string` | The Slack channel for critical notifications. | `mon-otomi-crit` |
| `home.slack.url` | `string` | A Slack webhook URL. |  |
| `kms.sops.provider` | `string` |  |  |
| `kms.sops.aws.keys` | `string` | Comma separated list of one or two ARNs to keys as defined in AWS KMS. One if used for both enc+dec. Two if one for enc, other for dec. (You can specify a role by appending it to the ARN of the key with a + sign.) |  |
| `kms.sops.aws.accessKey` | `string` | An AWS access key ID. |  |
| `kms.sops.aws.secretKey` | `string` | An AWS secret key. |  |
| `kms.sops.aws.region` | `string` | An AWS region. |  |
| `kms.sops.provider` | `string` |  |  |
| `kms.sops.azure.keys` | `string` | Comma separated list of one or two paths to keys as defined in Azure Keyvault. One if used for both enc+dec. Two if one for enc, other for dec. |  |
| `kms.sops.azure.clientId` | `string` | An Azure client id. |  |
| `kms.sops.azure.clientSecret` | `string` | An Azure client secret. |  |
| `kms.sops.azure.tenantId` | `string` | An Azure tenant id. |  |
| `kms.sops.provider` | `string` |  |  |
| `kms.sops.google.keys` | `string` | Comma separated list of one or two paths to keys as defined in GCP KMS. One if used for both enc+dec. Two if one for enc, other for dec. |  |
| `kms.sops.google.accountJson` | `string` |  |  |
| `kms.sops.google.project` | `string` |  |  |
| `kms.sops.provider` | `string` |  |  |
| `kms.sops.vault.keys` | `string` | Comma separated list of one or two paths to keys as defined in Vault. One if used for both enc+dec. Two if one for enc, other for dec. |  |
| `kms.sops.vault.token` | `string` |  |  |
| `letsencryptCA` | `string` |  |  |
| `letsencryptRootCA` | `string` |  |  |
| `oidc.adminGroupID` | `string` |  |  |
| `oidc.apiUrl` | `string` | Only used for grafana when Keycloak is disabled. (Not recommended because that disables authorization.) |  |
| `oidc.authUrl` | `string` | Only used for grafana when Keycloak is disabled. (Not recommended because that disables authorization.) |  |
| `oidc.clientID` | `string` |  |  |
| `oidc.clientSecret` | `string` |  |  |
| `oidc.issuer` | `string` |  |  |
| `oidc.scope` | `string` | Default values are used by keycloak. May be overridden in case keycloak is disabled. | `openid email profile` |
| `oidc.teamAdminGroupID` | `string` |  |  |
| `oidc.tenantID` | `string` |  |  |
| `oidc.tokenUrl` | `string` |  |  |
| `oidc.usernameClaimMapper` | `string` | Claim name used by Keycloak to identify incoming users from identity provider | `${CLAIM.email}` |
| `oidc.subClaimMapper` | `string` | Select OIDC claim to be passed by Keycloak as a unique user identifier. Best to not change this from the default. | `sub` |
| `otomi.additionalClusters.[].domainSuffix` | `string` |  |  |
| `otomi.additionalClusters.[].name` | `string` | A lowercase name that starts with a letter and may contain dashes. |  |
| `otomi.additionalClusters.[].provider` | `string` |  |  |
| `otomi.adminPassword` | `string` |  |  |
| `otomi.globalPullSecret.username` | `string` |  |  |
| `otomi.globalPullSecret.password` | `string` |  |  |
| `otomi.globalPullSecret.email` | `string` |  | `not@us.ed` |
| `otomi.globalPullSecret.server` | `string` |  | `docker.io` |
| `otomi.hasCloudLB` | `boolean` | Set this to true when an external LB exists or needs to be started (AWS ALB, Azure AppGW, Google Apigee). This will then be configured through ingress controllers. Expects existing LBs to terminate https. Currently this is only working correctly for Azure, and not for AWS and Google. AWS is close to completion. | `false` |
| `otomi.isHomeMonitored` | `boolean` | Whether this cluster is home monitored (like when under a Premium SLA). Sends criticals home. | `false` |
| `otomi.isManaged` | `boolean` | Whether masters are managed and not under control. Set this to false when onprem. | `true` |
| `otomi.isMultitenant` | `boolean` | Whether to separate team metrics and logs. Disabling this lets everybody be admin and see everything. | `true` |
| `otomi.version` | `string` | Best pin this to a valid release version found in the repo. | `latest` |
| `policies.banned-image-tags.tags.[]` | `string` |  |  |
| `policies.banned-image-tags.enabled` | `boolean` |  | `false` |
| `policies.container-limits.cpu` | `string` | Amount of cores, or slice of cpu in millis. |  |
| `policies.container-limits.memory` | `string` | Amount of memory. Valid units are E\|P\|T\|G\|M\|K\|Ei\|Pi\|Ti\|Gi\|Mi\|Ki. |  |
| `policies.container-limits.enabled` | `boolean` |  | `false` |
| `policies.psp-allowed-repos.repos.[]` | `string` |  |  |
| `policies.psp-allowed-repos.enabled` | `boolean` |  | `false` |
| `policies.psp-host-filesystem.allowedHostPaths.[].pathPrefix` | `string` |  |  |
| `policies.psp-host-filesystem.allowedHostPaths.[].readOnly` | `boolean` |  |  |
| `policies.psp-host-filesystem.enabled` | `boolean` |  | `false` |
| `policies.psp-allowed-users.runAsUser.rule` | `string` |  |  |
| `policies.psp-allowed-users.runAsUser.ranges.[].min` | `integer` |  |  |
| `policies.psp-allowed-users.runAsUser.ranges.[].max` | `integer` |  |  |
| `policies.psp-allowed-users.runAsGroup.rule` | `string` |  |  |
| `policies.psp-allowed-users.runAsGroup.ranges.[].min` | `integer` |  |  |
| `policies.psp-allowed-users.runAsGroup.ranges.[].max` | `integer` |  |  |
| `policies.psp-allowed-users.supplementalGroups.rule` | `string` |  |  |
| `policies.psp-allowed-users.supplementalGroups.ranges.[].min` | `integer` |  |  |
| `policies.psp-allowed-users.supplementalGroups.ranges.[].max` | `integer` |  |  |
| `policies.psp-allowed-users.fsGroup.rule` | `string` |  |  |
| `policies.psp-allowed-users.fsGroup.ranges.[].min` | `integer` |  |  |
| `policies.psp-allowed-users.fsGroup.ranges.[].max` | `integer` |  |  |
| `policies.psp-allowed-users.enabled` | `boolean` |  | `false` |
| `policies.psp-host-security.enabled` | `boolean` |  | `false` |
| `policies.psp-host-networking-ports.enabled` | `boolean` |  | `false` |
| `policies.psp-privileged.enabled` | `boolean` |  | `false` |
| `policies.psp-capabilities.enabled` | `boolean` |  | `false` |
| `policies.psp-capabilities.allowedCapabilities.[]` | `string` |  |  |
| `policies.psp-capabilities.requiredDropCapabilities.[]` | `string` |  |  |
| `policies.psp-forbidden-sysctls.enabled` | `boolean` |  | `false` |
| `policies.psp-forbidden-sysctls.forbiddenSysctls.[]` | `string` |  |  |
| `policies.psp-apparmor.enabled` | `boolean` |  | `false` |
| `policies.psp-apparmor.allowedProfiles.[]` | `string` |  |  |
| `policies.psp-seccomp.enabled` | `boolean` |  | `false` |
| `policies.psp-seccomp.allowedProfiles.[]` | `string` |  |  |
| `policies.psp-selinux.enabled` | `boolean` |  | `false` |
| `policies.psp-selinux.seLinuxContext` | `string` |  |  |
| `policies.psp-selinux.allowedSELinuxOptions.[].level` | `string` |  |  |
| `policies.psp-selinux.allowedSELinuxOptions.[].role` | `string` |  |  |
| `policies.psp-selinux.allowedSELinuxOptions.[].type` | `string` |  |  |
| `policies.psp-selinux.allowedSELinuxOptions.[].user` | `string` |  |  |
| `smtp.auth_identity` | `string` |  |  |
| `smtp.auth_password` | `string` |  |  |
| `smtp.auth_secret` | `string` |  |  |
| `smtp.auth_username` | `string` |  |  |
| `smtp.from` | `string` | The "from" address. Defaults to alerts@$clusterDomain. |  |
| `smtp.hello` | `string` |  |  |
| `smtp.smarthost` | `string` | The smtp host:port combination. |  |