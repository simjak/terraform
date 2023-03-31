import { EcsCluster } from '@cdktf/provider-aws/lib/ecs-cluster'
import { Construct } from 'constructs/lib'

export interface ApplicationECSClusterProps {
    prefix: string
    tags: { [key: string]: string }
}

export class ApplicationECSCluster extends Construct {
    public readonly cluster: EcsCluster

    constructor(scope: Construct, name: string, config: ApplicationECSClusterProps) {
        super(scope, name)

        this.cluster = new EcsCluster(this, 'ecs_cluster', {
            name: config.prefix,
            tags: { ...config.tags, name: config.prefix },
            setting: [
                {
                    name: 'containerInsights',
                    value: 'enabled',
                },
            ],
        })
    }
}
