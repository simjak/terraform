import { ApplicationStaticWebsiteBucket } from '../base/ApplicationStaticWebsiteBucket'
import { Construct } from 'constructs/lib'
import { ApplicationBaseDNS } from '../base/ApplicationBaseDNS'
import { ApplicationCertificate } from '../base/ApplicationCertificate'
import { Route53Record } from '@cdktf/provider-aws/lib/route53-record'
import { CloudfrontDistribution } from '@cdktf/provider-aws/lib/cloudfront-distribution'
import { CloudfrontOriginAccessIdentity } from '@cdktf/provider-aws/lib/cloudfront-origin-access-identity'
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket'
import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { CloudfrontResponseHeadersPolicy } from '@cdktf/provider-aws/lib/cloudfront-response-headers-policy'
import {
    ApplicationSnsTopics,
    DeploymentMode,
    Environment,
    getHostedZone,
    getTargetAccount,
    ThalloProduct,
    ThalloService,
} from './ThalloApplicationConfig'
import { ThalloAccountRegistry } from './ThalloAccountRegistry'
import { DataAwsSnsTopic } from '@cdktf/provider-aws/lib/data-aws-sns-topic'

export interface ThalloStaticApplicationConfigInput {
    productName: ThalloProduct
    serviceName: ThalloService
    domainPrefix: string
    deploymentMode: DeploymentMode
    environment: Environment
    aws: {
        profile?: string
    }
    application?: {
        contentPath?: string
    }
    codePipeline: {
        githubConnectionName: string
        gitRepositoryName: string
        gitRepositoryBranch: string
    }
    tags: { [key: string]: string }
}

export interface ThalloStaticApplicationConfig {
    productName: ThalloProduct
    serviceName: ThalloService
    deploymentMode: DeploymentMode
    environment: Environment
    aws: {
        region: string
        account: {
            sharedServices: string
            target: string
        }
        profile?: string
    }
    dns: {
        rootDomain: string
        fullDomain: string
        hostedZoneId?: string
    }
    application?: {
        contentPath?: string
    }
    codePipeline: {
        // sourceBucketId: string
        // application?: {}
        codeBuild: {
            image: string
        }
        githubConnectionName: string
        gitRepositoryName: string
        gitRepositoryBranch: string
    }
    tags: { [key: string]: string }
}

export class ThalloStaticApplication extends Construct {
    public readonly baseDNS: ApplicationBaseDNS
    public readonly websiteBucket: S3Bucket
    private readonly config: ThalloStaticApplicationConfig

    constructor(scope: Construct, id: string, config: ThalloStaticApplicationConfig) {
        super(scope, id)

        this.config = config

        this.baseDNS = new ApplicationBaseDNS(this, 'base_dns', {
            domain: config.dns.fullDomain,
            tags: config.tags,
        })

        this.websiteBucket = new ApplicationStaticWebsiteBucket(this, 'static_website_bucket', {
            serviceName: config.serviceName,
            environment: config.environment,
            absoluteContentPath: config.application?.contentPath,
            tags: config.tags,
        }).bucket

        const cloudfrontResponseHeaderPolicy = new CloudfrontResponseHeadersPolicy(
            this,
            'cloudfront_response_headers_policy',
            {
                name: 'cloudfront_response_headers_policy',
                comment: 'Managed by Terraform',
                corsConfig: {
                    accessControlAllowOrigins: { items: ['*'] },
                    accessControlAllowHeaders: { items: ['*'] },
                    accessControlAllowMethods: {
                        items: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
                    },
                    // accessControlExposeHeaders: { items: [''] },
                    accessControlAllowCredentials: false,
                    originOverride: true,
                },
            },
        )

        this.createCDN(this.websiteBucket, cloudfrontResponseHeaderPolicy)
    }

    // Create the CDN
    private createCDN(
        staticWebsiteBucket: S3Bucket,
        responseHeaderPolicy: CloudfrontResponseHeadersPolicy,
    ): CloudfrontDistribution {
        // Create certificate for the CDN

        const providerUsEast1 = new AwsProvider(this, 'aws_us_east_1', {
            region: 'us-east-1',
            alias: 'useast1',
            profile: this.config.aws.profile,
            assumeRole: [
                {
                    roleArn: `arn:aws:iam::${this.config.aws.account.target}:role/terraform-build-role`,
                },
            ],
        })

        // the cert HAS to live in us-east-1 if we want to use it in CloudFront (which we do)
        const cdnCertificate = new ApplicationCertificate(this, 'cdn_certificate', {
            domain: this.config.dns.fullDomain,
            provider: providerUsEast1,
            tags: this.config.tags,
            dependsOn: [this.baseDNS.zoneSharedServices],
        })

        // Create the CloudFront Origin Access Identity to allow the CDN to access the S3 bucket
        const originAccessIdentity = new CloudfrontOriginAccessIdentity(
            this,
            'cloudfront_origin_access_identity',
            {
                comment: `CloudFront OriginAccessIdentity for ${staticWebsiteBucket.bucket}`,
            },
        )

        // Create the CDN
        const cdn = new CloudfrontDistribution(this, 'cdn', {
            comment: 'CDN for the static website',
            enabled: true,
            aliases: [this.config.dns.fullDomain],
            priceClass: 'PriceClass_All',
            tags: this.config.tags,
            isIpv6Enabled: true,
            origin: [
                {
                    domainName: staticWebsiteBucket.bucketRegionalDomainName,
                    originId: 's3_origin_id_exchange_static_website',
                    s3OriginConfig: {
                        originAccessIdentity: originAccessIdentity.cloudfrontAccessIdentityPath,
                    },
                },
            ],
            defaultCacheBehavior: {
                targetOriginId: 's3_origin_id_exchange_static_website',
                viewerProtocolPolicy: 'redirect-to-https',
                compress: true,
                allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
                cachedMethods: ['GET', 'HEAD'],
                forwardedValues: {
                    queryString: false,
                    cookies: {
                        forward: 'none',
                    },
                },
                defaultTtl: 3600, // Use "0" to enable Use Origin Cache Header https://github.com/hashicorp/terraform-provider-aws/issues/19382
                minTtl: 0,
                maxTtl: 31536000, // 1 year
                responseHeadersPolicyId: responseHeaderPolicy.id,
            },
            viewerCertificate: {
                acmCertificateArn: cdnCertificate.arn, // default: 'cloudfront_default_certificate
                sslSupportMethod: 'sni-only',
                minimumProtocolVersion: 'TLSv1.2_2021',
            },
            restrictions: {
                geoRestriction: {
                    restrictionType: 'none',
                },
            },
            waitForDeployment: true,
            defaultRootObject: 'index.html',

            // If we don't do this when you refresh the page with a URL like this domain.com/o/23
            // CF tries to find the file on S3 under /o/23 which obviously doesn't exist.
            // This redirect forces the index.html to be served instead
            customErrorResponse: [
                {
                    errorCode: 403,
                    responseCode: 200,
                    responsePagePath: '/index.html',
                    errorCachingMinTtl: 2592000, // 30 days
                },
            ],
            dependsOn: [staticWebsiteBucket, cdnCertificate.certificateValidation],
        })

        // https://github.com/hashicorp/terraform-provider-aws/issues/19382
        cdn.addOverride('default_cache_behavior.default_ttl', 0)
        cdn.addOverride('default_cache_behavior.min_ttl', 0)

        new Route53Record(this, 'cdn_record', {
            name: this.config.dns.fullDomain,
            type: 'A',
            zoneId: this.baseDNS.zone.id,
            alias: {
                name: cdn.domainName,
                zoneId: cdn.hostedZoneId,
                evaluateTargetHealth: true,
            },
        })

        new Route53Record(this, 'cdn_record_shared_services', {
            name: this.config.dns.fullDomain,
            type: 'A',
            zoneId: this.baseDNS.zoneSharedServices.id,
            alias: {
                name: cdn.domainName,
                zoneId: cdn.hostedZoneId,
                evaluateTargetHealth: false,
            },
            provider: this.baseDNS.zoneSharedServices.provider,
        })

        return cdn
    }

    static createStaticAppConfig(
        config: ThalloStaticApplicationConfigInput,
    ): ThalloStaticApplicationConfig {
        const region = 'eu-west-1'
        const hostedZone = getHostedZone(config.environment)
        const sharedServicesAccount = ThalloAccountRegistry.infrastructure.sharedServices
        const targetAccount = getTargetAccount(config.environment, config.productName)

        return {
            productName: config.productName,
            serviceName: config.serviceName,
            deploymentMode: config.deploymentMode,
            environment: config.environment,
            aws: {
                region: region,
                account: {
                    sharedServices: sharedServicesAccount,
                    target: targetAccount,
                },
                profile: config.aws.profile,
            },
            dns: {
                rootDomain: hostedZone.name,
                fullDomain: `${config.domainPrefix}.${hostedZone.name}`,
            },
            application: {
                contentPath: config.application?.contentPath,
            },
            codePipeline: {
                gitRepositoryName: config.codePipeline.gitRepositoryName,
                gitRepositoryBranch: config.codePipeline.gitRepositoryBranch,
                githubConnectionName: config.codePipeline.githubConnectionName,
                codeBuild: {
                    image: `${sharedServicesAccount}.dkr.ecr.eu-west-1.amazonaws.com/cdktf-codebuild:main`,
                },
            },
            tags: config.tags,
        }
    }

    static getApplicationSnsTopics(
        scope: Construct,
        config: ThalloStaticApplicationConfig,
    ): ApplicationSnsTopics {
        // SNS for code deploy
        const deploymentSns = new DataAwsSnsTopic(scope, 'data_backend_sns_topic', {
            name: `Backend-${config.environment}-ChatBot`,
        })

        const criticalAlarmsSns = new DataAwsSnsTopic(scope, 'data_cr_alarm_sns_topic', {
            name: `CriticalAlarms-${config.environment}-ChatBot`,
        })

        const providerUsEast1 = new AwsProvider(scope, 'aws_us_east_1', {
            region: 'us-east-1',
            alias: 'us-east-1',
            profile: config.aws.profile,
            assumeRole: [
                {
                    roleArn: `arn:aws:iam::${config.aws.account.target}:role/terraform-build-role`,
                },
            ],
        })

        const criticalAlarmsSnsUsEast1 = new DataAwsSnsTopic(
            scope,
            'data_cr_alarm_use1_sns_topic',
            {
                provider: providerUsEast1,
                name: `CriticalAlarms-${config.environment}-ChatBot`,
            },
        )

        const nonCriticalAlarmsSns = new DataAwsSnsTopic(scope, 'data_non_cr_alarm_sns_topic', {
            name: `NonCriticalAlarms-${config.environment}-ChatBot`,
        })

        return { criticalAlarmsSns, criticalAlarmsSnsUsEast1, nonCriticalAlarmsSns, deploymentSns }
    }
}
