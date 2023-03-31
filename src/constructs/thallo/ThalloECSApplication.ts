import { CloudwatchMetricAlarmConfig } from '@cdktf/provider-aws/lib/cloudwatch-metric-alarm'
import { Construct } from 'constructs/lib'
import { ApplicationECSCluster } from '../base/ApplicationECSCluster'
import { ApplicationECSContainerDefinitionProps } from '../base/ApplicationECSContainerDefinition'
import { ApplicationECSIamProps } from '../base/ApplicationECSIam'
import { ApplicationECSService, ApplicationECSServiceProps } from '../base/ApplicationECSService'
import { Environment, ThalloService } from './ThalloApplicationConfig'

export type CreateECSServiceArgs = {
    ecs: ApplicationECSService
    cluster: ApplicationECSCluster
}

export interface ThalloECSApplicationProps {
    environment: Environment
    serviceName: ThalloService
    shortName: string
    region: string
    vpcConfig: {
        vpcId: string
        privateSubnetIds: string[]
    }
    tags: { [key: string]: string }
    containerConfigs: ApplicationECSContainerDefinitionProps[]
    taskSize?: {
        cpu: number
        memory: number
    }
    ecsIamConfig: ApplicationECSIamProps
    autoscalingConfig?: {
        targetMinCapacity?: number
        targetMaxCapacity?: number
        stepScaleInAdjustment?: number
        stepScaleOutAdjustment?: number
        scaleInThreshold?: number
        scaleOutThreshold?: number
    }
    alarms?: {
        alarms?: CloudwatchMetricAlarmConfig[]
    }
    desiredCount?: number
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

const DEFAULT_AUTOSCALING_CONFIG = {
    scaleOutThreshold: 45,
    scaleInThreshold: 30,
    targetMinCapacity: 1,
    targetMaxCapacity: 2,
    stepScaleInAdjustment: -1,
    stepScaleOutAdjustment: 2,
}

export class ThalloECSApplication extends Construct {
    public readonly ecsService: ApplicationECSService
    private readonly config: ThalloECSApplicationProps
    private readonly applicationVPC: ThalloECSApplicationProps['vpcConfig']

    constructor(scope: Construct, name: string, config: ThalloECSApplicationProps) {
        super(scope, name)
        this.config = config // TODO: add validation config

        // use default autoscaling config if not provided
        this.config.autoscalingConfig = {
            ...DEFAULT_AUTOSCALING_CONFIG,
            ...this.config.autoscalingConfig,
        }

        this.applicationVPC = this.config.vpcConfig

        const ecsService = this.createECSService()
        this.ecsService = ecsService.ecs

        // TODO: add Cloudwatch dashboard and alarms
    }

    private createECSService(): CreateECSServiceArgs {
        const ecsCluster = new ApplicationECSCluster(this, 'ecs_cluster', {
            prefix: this.config.serviceName,
            tags: this.config.tags,
        })

        let ecsConfig: ApplicationECSServiceProps = {
            serviceName: this.config.serviceName,
            shortName: this.config.shortName,
            region: this.config.region,
            environment: this.config.environment,
            ecsClusterArn: ecsCluster.cluster.arn,
            ecsClusterName: ecsCluster.cluster.name,
            vpcId: this.applicationVPC.vpcId,
            containerConfigs: this.config.containerConfigs,
            privateSubnets: this.applicationVPC.privateSubnetIds,
            ecsIamConfig: this.config.ecsIamConfig,
            tags: this.config.tags,
            desiredCount: this.config.desiredCount,
            useCodeDeploy: this.config.codeDeploy.useCodeDeploy,
            codeDeployNotifications: this.config.codeDeploy.notifications,
            useCodePipeline: this.config.codeDeploy.useCodePipeline,
            codeDeploySnsNotificationTopicArn: this.config.codeDeploy.snsNotificationTopicArn,
        }

        if (this.config.taskSize) {
            ecsConfig = {
                ...this.config.taskSize,
                ...ecsConfig,
            }
        }
        const ecsService = new ApplicationECSService(this, 'ecs_service', ecsConfig)

        // TODO: add autoscaling config

        return {
            ecs: ecsService,
            cluster: ecsCluster,
        }
    }
}
