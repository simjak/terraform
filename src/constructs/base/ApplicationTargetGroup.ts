import { Construct } from 'constructs/lib'
import { LbTargetGroup } from '@cdktf/provider-aws/lib/lb-target-group'

export interface ApplicationTargetGroupProps {
    shortName: string
    vpcId: string
    healthCheckPath?: string //TODO: make this required when ECS is ready
    tags?: { [key: string]: string }
}

export class ApplicationTargetGroup extends Construct {
    public readonly targetGroup: LbTargetGroup

    constructor(scope: Construct, name: string, props: ApplicationTargetGroupProps) {
        super(scope, name)

        this.targetGroup = new LbTargetGroup(this, 'ecs_target_group', {
            name: props.shortName,
            vpcId: props.vpcId,
            port: 80,
            protocol: 'HTTP',
            targetType: 'ip',
            deregistrationDelay: '120', // default is 300 seconds
            healthCheck: {
                path: props.healthCheckPath ?? '/',
                healthyThreshold: 5,
                unhealthyThreshold: 3,
                interval: 15,
            },
            tags: {
                ...props.tags,
                Name: `${props.shortName}`,
            },
        })
    }
}
