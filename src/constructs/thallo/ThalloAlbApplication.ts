import { Environment, ThalloService } from './ThalloApplicationConfig'
import { TerraformMetaArguments } from 'cdktf'
import { ApplicationRoute53HealthCheck } from './../base/ApplicationRoute53HealthCheck'
import { AlbListener } from '@cdktf/provider-aws/lib/alb-listener'
import {
    CloudwatchMetricAlarm,
    CloudwatchMetricAlarmConfig,
} from '@cdktf/provider-aws/lib/cloudwatch-metric-alarm'
import { Route53Record } from '@cdktf/provider-aws/lib/route53-record'
import { Construct } from 'constructs/lib'
import { ApplicationBaseDNS } from '../base/ApplicationBaseDNS'
import { ApplicationCertificate } from '../base/ApplicationCertificate'
import { ApplicationECSCluster } from '../base/ApplicationECSCluster'
import { ApplicationECSContainerDefinitionProps } from '../base/ApplicationECSContainerDefinition'
import { ApplicationECSIamProps } from '../base/ApplicationECSIam'
import { ApplicationECSService, ApplicationECSServiceProps } from '../base/ApplicationECSService'
import { ApplicationLoadBalancer } from '../base/ApplicationLoadBalancer'
import { CloudwatchDashboard } from '@cdktf/provider-aws/lib/cloudwatch-dashboard'
import { ApplicationAutoscaling } from '../base/ApplicationAutoscaling'
import { ThalloApplicationWAF } from './ThalloApplicationWAF'
import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket'

export interface ThalloAlbApplicationAlarmsProps {
    threshold?: number
    period?: number
    evaluationPeriods?: number
    datapointsToAlarm?: number
    actions?: string[]
    alarmDescription?: string
}

export interface ThalloAlbApplicationProps extends TerraformMetaArguments {
    environment: Environment
    awsProfile?: string
    serviceName: ThalloService
    alb6CharacterPrefix: string
    internal?: boolean
    region: string
    vpcConfig: {
        vpcId: string
        publicSubnetIds: string[]
        privateSubnetIds: string[]
    }
    domain: string
    baseHostedZoneId?: string
    containerConfigs: ApplicationECSContainerDefinitionProps[]
    exposedContainer: {
        name: string
        port: number
        healthCheckPath: string
    }
    taskSize?: {
        cpu: number
        memory: number
    }
    autoscalingConfig?: {
        targetMinCapacity?: number | 2
        targetMaxCapacity?: number | 6
        stepScaleInAdjustment?: number | -1
        stepScaleOutAdjustment?: number | 2
        scaleInThreshold?: number | 30
        scaleOutThreshold?: number | 45
    }
    ecsIamConfig: ApplicationECSIamProps
    wafEnabled?: boolean
    runDbMigration?: boolean
    tags: { [key: string]: string }

    // Option to define Cloudwatch alarms
    alarms?: {
        http5xxErrorPercentage?: ThalloAlbApplicationAlarmsProps
        httpLatency?: ThalloAlbApplicationAlarmsProps
        route53HealthCheck?: ThalloAlbApplicationAlarmsProps
        customAlarms?: CloudwatchMetricAlarmConfig[]
    }

    codeDeploy: {
        useCodePipeline?: boolean
        useCodeDeploy: boolean
        snsNotificationTopicArn?: string
        notifications?: {
            notifyOnStart?: boolean
            notifyOnSuccess?: boolean
            notifyOnFailure?: boolean
        }
    }
}

interface CreateALBResponse {
    alb: ApplicationLoadBalancer
    albRecord: Route53Record
    albCertificate: ApplicationCertificate
}

const DEFAULT_AUTOSCALING_CONFIG = {
    scaleOutThreshold: 45,
    scaleInThreshold: 30,
    targetMinCapacity: 2,
    targetMaxCapacity: 6,
    stepScaleInAdjustment: -1,
    stepScaleOutAdjustment: 2,
}

// Aware of Fargate changes https://stackoverflow.com/questions/61265108/aws-ecs-fargate-resourceinitializationerror-unable-to-pull-secrets-or-registry
export class ThalloAlbApplication extends Construct {
    public readonly alb: ApplicationLoadBalancer
    public readonly ecsService: ApplicationECSService
    public readonly baseDNS: ApplicationBaseDNS
    public readonly listeners: AlbListener[]
    public readonly ecsArtifactBucket: S3Bucket
    private readonly config: ThalloAlbApplicationProps
    private readonly applicationVpc: ThalloAlbApplicationProps['vpcConfig']
    private readonly route53HealthCheck: ApplicationRoute53HealthCheck

    constructor(scope: Construct, id: string, config: ThalloAlbApplicationProps) {
        super(scope, id)

        this.config = config // TODO: add validation

        this.listeners = []

        this.config.autoscalingConfig = {
            ...DEFAULT_AUTOSCALING_CONFIG,
            ...this.config.autoscalingConfig,
        }

        this.applicationVpc = this.getVpcConfig(config)

        this.baseDNS = new ApplicationBaseDNS(this, 'base_dns', {
            domain: config.domain,
            tags: config.tags,
        })

        const { alb, albCertificate } = this.createALB()
        this.alb = alb

        const ecsService = this.createEcsService(alb, albCertificate)
        this.ecsService = ecsService.ecs

        this.ecsArtifactBucket = this.ecsService.ecsArtifactBucket

        this.createCloudwatchDashboard(
            alb.alb.arnSuffix,
            ecsService.ecs.service.name,
            ecsService.cluster.cluster.name,
        )

        this.route53HealthCheck = this.createRoute53HealthCheck()

        this.createCloudwatchAlarms()

        if (config.wafEnabled) {
            this.createWaf([this.alb.alb.arn])
        }
    }
    private createRoute53HealthCheck(): ApplicationRoute53HealthCheck {
        return new ApplicationRoute53HealthCheck(this, 'health_check', {
            name: this.config.serviceName,
            resourcePath: this.config.exposedContainer.healthCheckPath ?? '/',
            domain: this.config.domain,
        })
    }
    private createWaf(associatedResources: string[]): ThalloApplicationWAF {
        return new ThalloApplicationWAF(this, 'waf', {
            name: this.config.serviceName,
            associatedResources: associatedResources,
            tags: this.config.tags,
        })
    }

    private getVpcConfig(
        config: ThalloAlbApplicationProps,
    ): ThalloAlbApplicationProps['vpcConfig'] {
        return {
            vpcId: config.vpcConfig.vpcId,
            publicSubnetIds: config.vpcConfig.publicSubnetIds,
            privateSubnetIds: config.vpcConfig.privateSubnetIds,
        }
    }

    // Creates ALB stack and certificates
    private createALB(): CreateALBResponse {
        const alb = new ApplicationLoadBalancer(this, 'alb', {
            vpcId: this.applicationVpc.vpcId,
            prefix: this.config.serviceName,
            alb6CharacterPrefix: this.config.alb6CharacterPrefix,
            subnetIds: this.config.internal
                ? this.applicationVpc.privateSubnetIds
                : this.applicationVpc.publicSubnetIds,
            internal: this.config.internal,
            tags: this.config.tags,
        })

        const albDomainName = this.config.domain

        const albRecord = new Route53Record(this, 'alb_record', {
            name: albDomainName,
            type: 'A',
            zoneId: this.baseDNS.zone.zoneId,
            weightedRoutingPolicy: {
                weight: 1,
            },
            alias: {
                name: alb.alb.dnsName,
                zoneId: alb.alb.zoneId,
                evaluateTargetHealth: true,
            },
            lifecycle: {
                ignoreChanges: ['weighted_routing_policy[0].weight'],
            },
            setIdentifier: '1',
        })

        new Route53Record(this, 'alb_record_shared_service', {
            name: albDomainName,
            type: 'A',
            zoneId: this.baseDNS.zoneSharedServices.zoneId,
            weightedRoutingPolicy: {
                weight: 1,
            },
            alias: {
                name: alb.alb.dnsName,
                zoneId: alb.alb.zoneId,
                evaluateTargetHealth: true,
            },
            lifecycle: {
                ignoreChanges: ['weighted_routing_policy[0].weight'],
            },
            setIdentifier: '1',
            provider: this.baseDNS.zoneSharedServices.provider,
        })

        const albCertificate = new ApplicationCertificate(this, 'alb_certificate', {
            domain: albDomainName,
            tags: this.config.tags,
            dependsOn: [this.baseDNS.zoneSharedServices, this.baseDNS.zone],
        })
        return { alb, albRecord, albCertificate }
    }

    // Creates ECS service and attach it to ALB
    private createEcsService(
        alb: ApplicationLoadBalancer,
        albCertificate: ApplicationCertificate,
    ): { ecs: ApplicationECSService; cluster: ApplicationECSCluster } {
        const ecsCluster = new ApplicationECSCluster(this, 'ecs_alb_cluster', {
            prefix: this.config.serviceName,
            tags: this.config.tags,
        })

        const httpListener = new AlbListener(this, 'http_listener', {
            loadBalancerArn: alb.alb.arn,
            port: 80,
            protocol: 'HTTP',
            defaultAction: [
                {
                    type: 'redirect',
                    redirect: { port: '443', protocol: 'HTTPS', statusCode: 'HTTP_301' },
                },
            ],
        })

        const httpsListener = new AlbListener(this, 'https_listener', {
            loadBalancerArn: alb.alb.arn,
            port: 443,
            protocol: 'HTTPS',
            defaultAction: [
                {
                    type: 'fixed-response',
                    fixedResponse: {
                        contentType: 'text/plain',
                        statusCode: '503',
                        messageBody: '',
                    },
                },
            ],
            certificateArn: albCertificate.arn,
        })

        // Other resources can make changes on ALB listeners
        this.listeners.push(httpListener, httpsListener)

        let ecsConfig: ApplicationECSServiceProps = {
            serviceName: this.config.serviceName,
            environment: this.config.environment,
            region: this.config.region,
            shortName: this.config.alb6CharacterPrefix,
            ecsClusterArn: ecsCluster.cluster.arn,
            ecsClusterName: ecsCluster.cluster.name,
            albConfig: {
                containerPort: this.config.exposedContainer.port,
                containerName: this.config.exposedContainer.name,
                healthCheckPath: this.config.exposedContainer.healthCheckPath,
                listenerArn: httpsListener.arn,
                albSecurityGroupId: alb.securityGroup.id,
            },
            vpcId: this.applicationVpc.vpcId,
            containerConfigs: this.config.containerConfigs,
            privateSubnets: this.applicationVpc.privateSubnetIds,
            ecsIamConfig: this.config.ecsIamConfig,
            runDbMigration: this.config.runDbMigration,
            useCodeDeploy: this.config.codeDeploy.useCodeDeploy,
            codeDeployNotifications: this.config.codeDeploy.notifications,
            useCodePipeline: this.config.codeDeploy.useCodePipeline,
            codeDeploySnsNotificationTopicArn: this.config.codeDeploy.snsNotificationTopicArn,
            tags: this.config.tags,
        }

        if (this.config.taskSize) {
            ecsConfig = {
                ...this.config.taskSize,
                ...ecsConfig,
            }
        }

        const ecsService = new ApplicationECSService(this, 'ecs_service', ecsConfig)

        new ApplicationAutoscaling(this, 'ecs_alb_autoscaling', {
            prefix: this.config.serviceName,
            targetMinCapacity:
                this.config.autoscalingConfig?.targetMinCapacity ??
                DEFAULT_AUTOSCALING_CONFIG.targetMinCapacity,
            targetMaxCapacity:
                this.config.autoscalingConfig?.targetMaxCapacity ??
                DEFAULT_AUTOSCALING_CONFIG.targetMaxCapacity,
            ecsClusterName: ecsCluster.cluster.name,
            ecsServiceName: ecsService.service.name,
            scalableDimension: 'ecs:service:DesiredCount',
            stepScaleInAdjustment:
                this.config.autoscalingConfig?.stepScaleInAdjustment ??
                DEFAULT_AUTOSCALING_CONFIG.stepScaleInAdjustment,
            stepScaleOutAdjustment:
                this.config.autoscalingConfig?.stepScaleOutAdjustment ??
                DEFAULT_AUTOSCALING_CONFIG.stepScaleOutAdjustment,
            scaleInThreshold:
                this.config.autoscalingConfig?.scaleInThreshold ??
                DEFAULT_AUTOSCALING_CONFIG.scaleInThreshold,
            scaleOutThreshold:
                this.config.autoscalingConfig?.scaleOutThreshold ??
                DEFAULT_AUTOSCALING_CONFIG.scaleOutThreshold,
            tags: this.config.tags,
        })

        return { ecs: ecsService, cluster: ecsCluster }
    }

    // Create a CloudWatch dashboard JSON
    private createCloudwatchDashboard(
        albArnSuffix: string,
        ecsServiceName: string,
        ecsServiceClusterName: string,
    ): CloudwatchDashboard {
        const dashboardJSON = {
            widgets: [
                {
                    type: 'metric',
                    x: 0,
                    y: 0,
                    width: 12,
                    height: 6,
                    properties: {
                        metrics: [
                            [
                                'AWS/ApplicationELB',
                                'HTTPCode_Target_4XX_Count',
                                'LoadBalancer',
                                albArnSuffix,
                                {
                                    yAxis: 'left',
                                    color: '#ff7f0e',
                                },
                            ],
                            [
                                '.',
                                'RequestCount',
                                '.',
                                '.',
                                {
                                    yAxis: 'right',
                                    color: '#1f77b4',
                                },
                            ],
                            [
                                '.',
                                'HTTPCode_Target_5XX_Count',
                                '.',
                                '.',
                                {
                                    color: '#d62728',
                                },
                            ],
                            [
                                '.',
                                'HTTPCode_Target_2XX_Count',
                                '.',
                                '.',
                                {
                                    yAxis: 'right',
                                    color: '#2ca02c',
                                },
                            ],
                        ],
                        view: 'timeSeries',
                        stacked: false,
                        region: this.config.region ?? 'eu-west-1',
                        period: 60,
                        stat: 'Sum',
                        title: 'Target Requests',
                    },
                },
                {
                    type: 'metric',
                    x: 12,
                    y: 6,
                    width: 12,
                    height: 6,
                    properties: {
                        metrics: [
                            [
                                'AWS/ApplicationELB',
                                'TargetResponseTime',
                                'LoadBalancer',
                                albArnSuffix,
                                {
                                    label: 'Average',
                                    color: '#aec7e8',
                                },
                            ],
                            [
                                '...',
                                {
                                    stat: 'p95',
                                    label: 'p95',
                                    color: '#ffbb78',
                                },
                            ],
                            [
                                '...',
                                {
                                    stat: 'p99',
                                    label: 'p99',
                                    color: '#98df8a',
                                },
                            ],
                        ],
                        view: 'timeSeries',
                        stacked: false,
                        region: this.config.region ?? 'eu-west-1',
                        stat: 'Average',
                        period: 60,
                    },
                },
                {
                    type: 'metric',
                    x: 0,
                    y: 6,
                    width: 12,
                    height: 6,
                    properties: {
                        metrics: [
                            [
                                'ECS/ContainerInsights',
                                'RunningTaskCount',
                                'ServiceName',
                                ecsServiceName,
                                'ClusterName',
                                ecsServiceClusterName,
                                {
                                    yAxis: 'right',
                                    color: '#c49c94',
                                },
                            ],
                            [
                                'AWS/ECS',
                                'CPUUtilization',
                                '.',
                                '.',
                                '.',
                                '.',
                                {
                                    color: '#f7b6d2',
                                },
                            ],
                            [
                                '.',
                                'MemoryUtilization',
                                '.',
                                '.',
                                '.',
                                '.',
                                {
                                    color: '#c7c7c7',
                                },
                            ],
                        ],
                        view: 'timeSeries',
                        stacked: false,
                        region: this.config.region ?? 'eu-west-1',
                        stat: 'Average',
                        period: 60,
                        annotations: {
                            horizontal: [
                                {
                                    color: '#e377c2',
                                    label: 'CPU scale out',
                                    value:
                                        this.config.autoscalingConfig?.scaleOutThreshold ??
                                        DEFAULT_AUTOSCALING_CONFIG.scaleOutThreshold,
                                },
                                {
                                    color: '#c5b0d5',
                                    label: 'CPU scale in',
                                    value:
                                        this.config.autoscalingConfig?.scaleInThreshold ??
                                        DEFAULT_AUTOSCALING_CONFIG.scaleInThreshold,
                                },
                            ],
                        },
                        title: 'Service Load',
                    },
                },
            ],
        }
        return new CloudwatchDashboard(this, 'cloudwatch_dashboard', {
            dashboardName: `${this.config.serviceName}-ALB-dashboard`,
            dashboardBody: JSON.stringify(dashboardJSON),
        })
    }

    // Create a CloudWatch alarms
    private createCloudwatchAlarms(): void {
        const alarmConfig = this.config.alarms
        const evaluationPeriods = {
            http5xxErrorPercentage: alarmConfig?.http5xxErrorPercentage?.evaluationPeriods ?? 5,
            httpLatency: alarmConfig?.httpLatency?.evaluationPeriods ?? 1,
        }

        // HTTP 5xx error alarm
        const http5xxAlarm: CloudwatchMetricAlarmConfig = {
            alarmName: 'Alarm-HTTPTarget5xxErrorRate',
            metricQuery: [
                {
                    id: 'requests',
                    metric: {
                        metricName: 'RequestCount',
                        namespace: 'AWS/ApplicationELB',
                        period: alarmConfig?.http5xxErrorPercentage?.period ?? 60,
                        stat: 'Sum',
                        unit: 'Count',
                        dimensions: { LoadBalancer: this.alb.alb.arnSuffix },
                    },
                },
                {
                    id: 'errors',
                    metric: {
                        metricName: 'HTTPCode_Target_5XX_Count',
                        namespace: 'AWS/ApplicationELB',
                        period: alarmConfig?.http5xxErrorPercentage?.period ?? 60,
                        stat: 'Sum',
                        unit: 'Count',
                        dimensions: { LoadBalancer: this.alb.alb.arnSuffix },
                    },
                },
                {
                    id: 'expression',
                    expression: 'errors / requests * 100',
                    label: 'HTTP 5xx Error Rate',
                    returnData: true,
                },
            ],
            comparisonOperator: 'GreaterThanOrEqualToThreshold',
            evaluationPeriods: evaluationPeriods.http5xxErrorPercentage,
            datapointsToAlarm:
                alarmConfig?.http5xxErrorPercentage?.datapointsToAlarm ??
                evaluationPeriods.http5xxErrorPercentage,
            threshold: alarmConfig?.http5xxErrorPercentage?.threshold ?? 5,
            insufficientDataActions: [],
            alarmActions: alarmConfig?.http5xxErrorPercentage?.actions ?? [],
            okActions: alarmConfig?.http5xxErrorPercentage?.actions ?? [],
            tags: this.config.tags,
            alarmDescription:
                alarmConfig?.http5xxErrorPercentage?.alarmDescription ??
                'Percentage of HTTP 5xx responses exceeds threshold',
        }

        // HTTP latency alarm
        const latencyAlarm: CloudwatchMetricAlarmConfig = {
            alarmName: 'Alarm-HTTPResponseTime',
            namespace: 'AWS/ApplicationELB',
            metricName: 'TargetResponseTime',
            dimensions: { LoadBalancer: this.alb.alb.arnSuffix },
            period: alarmConfig?.httpLatency?.period ?? 300,
            evaluationPeriods: evaluationPeriods.httpLatency,
            datapointsToAlarm:
                alarmConfig?.httpLatency?.datapointsToAlarm ?? evaluationPeriods.httpLatency,
            statistic: 'Average',
            comparisonOperator: 'GreaterThanThreshold',
            threshold: alarmConfig?.httpLatency?.threshold ?? 300,
            alarmDescription:
                alarmConfig?.httpLatency?.alarmDescription ??
                'Average HTTP response time exceeds threshold',
            insufficientDataActions: [],
            alarmActions: alarmConfig?.httpLatency?.actions ?? [],
            okActions: alarmConfig?.httpLatency?.actions ?? [],
            tags: this.config.tags,
        }

        // Default alarms
        const defaultAlarms: CloudwatchMetricAlarmConfig[] = []

        if (alarmConfig?.http5xxErrorPercentage) defaultAlarms.push(http5xxAlarm)

        if (alarmConfig?.httpLatency) defaultAlarms.push(latencyAlarm)

        if (alarmConfig?.customAlarms) {
            defaultAlarms.push(...alarmConfig.customAlarms)
        }

        if (defaultAlarms.length) {
            this.createAlarms(defaultAlarms)
        }
    }

    private createAlarms(alarms: CloudwatchMetricAlarmConfig[]): void {
        alarms.forEach((alarmConfig) => {
            new CloudwatchMetricAlarm(this, alarmConfig.alarmName.toLowerCase(), {
                ...alarmConfig,
                alarmName: `${this.config.serviceName}-${alarmConfig.alarmName}`,
            })
        })

        const alarmConfig = this.config.alarms
        // Route53 health check alarm
        const healthCheckAlarm: CloudwatchMetricAlarmConfig = {
            alarmName: 'Alarm-Route53HealthCheck',
            namespace: 'AWS/Route53',
            metricName: 'HealthCheckStatus',
            dimensions: { HealthCheckId: this.route53HealthCheck.healthCheck.id },
            period: alarmConfig?.route53HealthCheck?.period ?? 60,
            evaluationPeriods: alarmConfig?.route53HealthCheck?.evaluationPeriods ?? 1,
            datapointsToAlarm: alarmConfig?.route53HealthCheck?.datapointsToAlarm ?? 1,
            statistic: 'Minimum',
            comparisonOperator: 'LessThanThreshold',
            threshold: alarmConfig?.route53HealthCheck?.threshold ?? 1,
            alarmDescription: alarmConfig?.route53HealthCheck?.alarmDescription,
            insufficientDataActions: [],
            alarmActions: alarmConfig?.route53HealthCheck?.actions ?? [],
            okActions: alarmConfig?.route53HealthCheck?.actions ?? [],
            tags: this.config.tags,
        }

        const providerUsEast1 = new AwsProvider(this, 'aws_us_east_1', {
            region: 'us-east-1',
            alias: 'us-east-1',
            profile: this.config.awsProfile ?? undefined,
        })

        new CloudwatchMetricAlarm(this, healthCheckAlarm.alarmName.toLowerCase(), {
            provider: providerUsEast1,

            ...healthCheckAlarm,
            alarmName: `${this.config.domain}-${healthCheckAlarm.alarmName}`,
        })
    }
}
