import { Route53HealthCheck } from '@cdktf/provider-aws/lib/route53-health-check'
import { Construct } from 'constructs'

export interface ApplicationRoute53HealthCheckProps {
    name: string
    resourcePath: string
    domain: string
}

export class ApplicationRoute53HealthCheck extends Construct {
    public readonly healthCheck: Route53HealthCheck
    constructor(
        scope: Construct,
        name: string,
        private config: ApplicationRoute53HealthCheckProps,
    ) {
        super(scope, name)

        this.healthCheck = this.getHealthCheck()
    }

    private getHealthCheck(): Route53HealthCheck {

        


        return new Route53HealthCheck(this, 'health-check', {
            fqdn: this.config.domain,
            type: 'HTTPS',
            port: 443,
            failureThreshold: 5,
            requestInterval: 30,
            resourcePath: this.config.resourcePath,
            cloudwatchAlarmName: `${this.config.domain}-r53-health-check`,
        })
    }
}
