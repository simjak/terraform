import { ThalloAccountRegistry, ThalloRegion } from './../thallo/ThalloAccountRegistry'
import { AcmCertificate } from '@cdktf/provider-aws/lib/acm-certificate'
import { AcmCertificateValidation } from '@cdktf/provider-aws/lib/acm-certificate-validation'
import { DataAwsRoute53Zone } from '@cdktf/provider-aws/lib/data-aws-route53-zone'
import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { Route53Record } from '@cdktf/provider-aws/lib/route53-record'
import { Construct } from 'constructs/lib'
import { ITerraformDependable } from 'cdktf'

export interface ApplicationCertificateProps {
    domain: string
    provider?: AwsProvider
    dependsOn?: ITerraformDependable[]
    tags?: { [key: string]: string }
}

export class ApplicationCertificate extends Construct {
    public readonly arn: string
    public readonly certificateValidation: AcmCertificateValidation

    constructor(scope: Construct, id: string, config: ApplicationCertificateProps) {
        super(scope, id)
        const sharedServiceProvider = new AwsProvider(this, 'shared_services', {
            region: ThalloRegion.EU_WEST_1,
            alias: 'shared_services_provider',
            assumeRole: [
                {
                    roleArn: `arn:aws:iam::${ThalloAccountRegistry.infrastructure.sharedServices}:role/terraform-build-role`,
                },
            ],
        })

        const certificate = this.generateAcmCertificate(
            this,
            config.domain,
            config.provider,
            config.tags,
        )

        const hostedZone = new DataAwsRoute53Zone(this, 'zone_target', {
            name: config.domain,
            dependsOn: config.dependsOn,
        })

        const hostedZoneSharedServices = new DataAwsRoute53Zone(this, 'zone_shared_service', {
            name: config.domain,
            provider: sharedServiceProvider,
            dependsOn: config.dependsOn,
        })

        const certificateRecord = this.createRecord(this, 'target', hostedZone, certificate)

        // It is needed to validate certificate, to have CNAME in both shared services and target account
        this.createRecord(
            this,
            'shared',
            hostedZoneSharedServices,
            certificate,
            sharedServiceProvider,
        )

        const validation = this.generateAcmCertificateValidation(
            this,
            certificate,
            certificateRecord,
            config.provider,
        )

        this.arn = certificate.arn
        this.certificateValidation = validation
    }

    private generateAcmCertificate(
        resource: Construct,
        domain: string,
        provider?: AwsProvider,
        tags?: { [key: string]: string },
    ): AcmCertificate {
        return new AcmCertificate(resource, 'certificate', {
            domainName: domain,
            validationMethod: 'DNS',
            tags: tags,
            lifecycle: {
                createBeforeDestroy: true,
            },
            provider: provider,
        })
    }

    private generateAcmCertificateValidation(
        resource: Construct,
        cert: AcmCertificate,
        record: Route53Record,
        provider?: AwsProvider,
    ): AcmCertificateValidation {
        return new AcmCertificateValidation(resource, 'certificate_validation', {
            certificateArn: cert.arn,
            validationRecordFqdns: [record.fqdn],
            provider: provider,
            // dependsOn: [cert],
            dependsOn: [record, cert],
        })
    }

    private createRecord(
        resource: Construct,
        zoneAccountName: string, //TODO we need UID for this
        zone: DataAwsRoute53Zone,
        cert: AcmCertificate,
        provider?: AwsProvider,
    ): Route53Record {
        return new Route53Record(resource, `record_${zoneAccountName}`, {
            zoneId: zone.zoneId,
            name: cert.domainValidationOptions.get(0).resourceRecordName,
            type: cert.domainValidationOptions.get(0).resourceRecordType,
            records: [cert.domainValidationOptions.get(0).resourceRecordValue],
            ttl: 60,
            allowOverwrite: true,
            provider: provider,
            dependsOn: [cert, zone],
        })
    }
}
