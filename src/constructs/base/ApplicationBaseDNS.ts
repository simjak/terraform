import { ThalloAccountRegistry, ThalloRegion } from './../thallo/ThalloAccountRegistry'
import { getRootDomain } from '../../utils/utils'
import { DataAwsRoute53Zone } from '@cdktf/provider-aws/lib/data-aws-route53-zone'
import { Construct } from 'constructs/lib'
import { Route53Zone } from '@cdktf/provider-aws/lib/route53-zone'
import { Route53Record } from '@cdktf/provider-aws/lib/route53-record'
import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { TerraformMetaArguments } from 'cdktf'

export interface ApplicationBaseDNSProps extends TerraformMetaArguments {
    domain: string
    tags?: { [key: string]: string }
}

export class ApplicationBaseDNS extends Construct {
    public readonly zone: Route53Zone
    public readonly zoneSharedServices: Route53Zone

    constructor(scope: Construct, name: string, private config: ApplicationBaseDNSProps) {
        super(scope, name)

        const sharedServicesProvider = new AwsProvider(this, 'shared_services_provider', {
            region: ThalloRegion.EU_WEST_1,
            assumeRole: [
                {
                    roleArn: `arn:aws:iam::${ThalloAccountRegistry.infrastructure.sharedServices}:role/terraform-build-role`,
                },
            ],
            alias: 'shared_services_dns',
        })

        const baseHostedZone = new DataAwsRoute53Zone(scope, `${name}_base_hosted_zone`, {
            provider: sharedServicesProvider,
            name: getRootDomain(this.config.domain),
        })

        const sharedServicesSubHostedZone = new Route53Zone(this, 'subhosted_zone_shared_service', {
            provider: sharedServicesProvider,
            name: this.config.domain,
            tags: this.config.tags,
        })
        this.zoneSharedServices = sharedServicesSubHostedZone

        new Route53Record(this, 'hosted_zone_ns_record', {
            name: this.config.domain,
            zoneId: baseHostedZone.id, // Shared services account
            type: 'NS',
            ttl: 86400,
            records: sharedServicesSubHostedZone.nameServers,
            allowOverwrite: true,
            dependsOn: [sharedServicesSubHostedZone],
            provider: sharedServicesProvider,
        })

        // Create subHostedZone in target account
        const targetSubHostedZone = new Route53Zone(this, 'subhosted_zone_target', {
            name: this.config.domain,
            tags: this.config.tags,
        })

        this.zone = targetSubHostedZone

        // subHostedZone in shared services account and subHostedZone in target account should be mapped by NS records
        new Route53Record(this, 'subhosted_zone_ns_record', {
            name: this.config.domain,
            zoneId: targetSubHostedZone.zoneId, // Target account
            type: 'NS',
            ttl: 86400,
            records: sharedServicesSubHostedZone.nameServers, // Shared services account
            allowOverwrite: true,
            dependsOn: [targetSubHostedZone],
        })
    }
}
