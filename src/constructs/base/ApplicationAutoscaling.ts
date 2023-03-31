import { AppautoscalingPolicy } from '@cdktf/provider-aws/lib/appautoscaling-policy'
import { AppautoscalingTarget } from '@cdktf/provider-aws/lib/appautoscaling-target'
import { CloudwatchMetricAlarm } from '@cdktf/provider-aws/lib/cloudwatch-metric-alarm'
import { Construct } from 'constructs/lib'


export interface ApplicationAutoscalingProps {
    ecsClusterName: string
    ecsServiceName: string
    prefix: string
    scalableDimension: string
    scaleInThreshold: number
    scaleOutThreshold: number
    stepScaleInAdjustment: number
    stepScaleOutAdjustment: number
    targetMinCapacity: number
    targetMaxCapacity: number
    tags: { [key: string]: string }
}

export class ApplicationAutoscaling extends Construct {
    constructor(scope: Construct, name: string, config: ApplicationAutoscalingProps) {
        super(scope, name)

        // Setup Autoscaling target and in/out policies
        const autoscalingTarget = ApplicationAutoscaling.generateAutoscalingTarget(
            this,
            config,
        )

        const applicationScaleOut = ApplicationAutoscaling.generateAutoscalingPolicy(
            this,
            config,
            autoscalingTarget,
            'Out',
        )

        const applicationScaleIn = ApplicationAutoscaling.generateAutoscalingPolicy(
            this,
            config,
            autoscalingTarget,
            'In',
        )

        // Setup Cloudwatch alarms
        // Scale Out alarm
        ApplicationAutoscaling.generateCloudwatchMetricAlarm(
            this,
            config,
            'scale_out_alarm',
            `${config.prefix} Service High CPU`,
            'Alarm to add capacity if container CPU is high',
            'GreaterThanOrEqualToThreshold',
            config.scaleOutThreshold,
            applicationScaleOut.arn,
        )

        // Scale In alarm
        ApplicationAutoscaling.generateCloudwatchMetricAlarm(
            this,
            config,
            'scale_in_alarm',
            `${config.prefix} Service Low CPU`,
            'Alarm to remove capacity if container CPU is low',
            'LessThanThreshold',
            config.scaleInThreshold,
            applicationScaleIn.arn,
        )
    }

    // Create Autoscaling target
    static generateAutoscalingTarget(
        scope: Construct,
        config: ApplicationAutoscalingProps,
        // iamRole: IamRole,
    ): AppautoscalingTarget {
        return new AppautoscalingTarget(scope, `${config.prefix}-ecs-autoscaling-target`, {
            maxCapacity: config.targetMaxCapacity,
            minCapacity: config.targetMinCapacity,
            resourceId: `service/${config.ecsClusterName}/${config.ecsServiceName}`,
            scalableDimension: 'ecs:service:DesiredCount',
            serviceNamespace: 'ecs',
        })
    }

    // Create Autoscaling policy
    static generateAutoscalingPolicy(
        scope: Construct,
        config: ApplicationAutoscalingProps,
        autoscalingTarget: AppautoscalingTarget,
        type: 'In' | 'Out',
    ): AppautoscalingPolicy {
        let stepAdjustment

        if (type === 'In') {
            stepAdjustment = [
                {
                    metricIntervalUpperBound: '0',
                    scalingAdjustment: config.stepScaleInAdjustment,
                },
            ]
        } else {
            stepAdjustment = [
                {
                    metricIntervalLowerBound: '0',
                    scalingAdjustment: config.stepScaleOutAdjustment,
                },
            ]
        }

        const appAutoscalingPolicy = new AppautoscalingPolicy(
            scope,
            `${config.prefix}-ecs-autoscaling-policy-${type}`,
            {
                name: `${config.prefix}-ecs-autoscaling-policy-${type}`,
                policyType: 'StepScaling',
                resourceId: autoscalingTarget.resourceId,
                scalableDimension: autoscalingTarget.scalableDimension,
                serviceNamespace: autoscalingTarget.serviceNamespace,
                stepScalingPolicyConfiguration: {
                    adjustmentType: 'ChangeInCapacity',
                    cooldown: 60,
                    metricAggregationType: 'Average',
                    stepAdjustment: stepAdjustment,
                },
                dependsOn: [autoscalingTarget],
            },
        )

        // Fix. Terraform outputing this as a {} and doesn't like this being an empty object, but it is ok with a null value
        appAutoscalingPolicy.addOverride('target_tracking_scaling_policy_configuration', null)

        return appAutoscalingPolicy
    }

    // Create Cloudwatch metric alarm
    static generateCloudwatchMetricAlarm(
        scope: Construct,
        config: ApplicationAutoscalingProps,
        id: string,
        name: string,
        desc: string,
        operator: string,
        threshold: number,
        arn: string,
    ): void {
        new CloudwatchMetricAlarm(scope, id, {
            alarmName: name,
            alarmDescription: desc,
            comparisonOperator: operator,
            evaluationPeriods: 2,
            metricName: 'CPUUtilization',
            namespace: 'AWS/ECS',
            period: 60,
            statistic: 'Average',
            threshold: threshold,
            treatMissingData: 'notBreaching',
            dimensions: {
                ClusterName: config.ecsClusterName,
                ServiceName: config.ecsServiceName,
            },
            alarmActions: [arn],
            tags: config.tags,
        })
    }
}
