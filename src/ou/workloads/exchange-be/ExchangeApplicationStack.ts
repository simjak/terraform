import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { Fn, S3Backend, TerraformStack } from 'cdktf'
import { Construct } from 'constructs/lib'
import { ThalloAlbApplication } from '../../../constructs/thallo/ThalloAlbApplication'
import {
    getDeploymentParameters,
    getVpcParameters,
    createApplicationConfig,
    ThalloApplicationConfig,
    getApplicationSnsTopics,
    DeploymentParameters,
    ApplicationSnsTopics,
} from '../../../constructs/thallo/ThalloApplicationConfig'
import { exchangeConfigInput } from './ExchangeConfig'
import { NullProvider } from '@cdktf/provider-null/lib/provider'
import { LocalProvider } from '@cdktf/provider-local/lib/provider'
import { S3Object } from '@cdktf/provider-aws/lib/s3-object'
import { VpcData } from '../../../constructs/thallo/ThalloVpc'
import { ThalloECSCodePipeline } from '../../../constructs/thallo/ThalloECSCodePipeline'
import { ArchiveProvider } from '@cdktf/provider-archive/lib/provider'
import { RandomProvider } from '@cdktf/provider-random/lib/provider'

export class ExchangeApplicationStack extends TerraformStack {
    constructor(scope: Construct, name: string) {
        super(scope, name)

        const config = createApplicationConfig(exchangeConfigInput)

        new NullProvider(this, 'null', {})
        new LocalProvider(this, 'local', {})
        new ArchiveProvider(this, 'archive', {})
        new RandomProvider(this, 'random', {})

        new AwsProvider(this, 'aws', {
            profile: config.aws.profile,
            region: config.aws.region,
            assumeRole: [
                {
                    roleArn: `arn:aws:iam::${config.aws.account.target}:role/terraform-build-role`,
                },
            ],
        })

        new S3Backend(this, {
            // Terraform state buckets are in the shared services account
            roleArn: `arn:aws:iam::${config.aws.account.sharedServices}:role/terraform-build-role`,
            bucket: `tf-state.${config.serviceName}.${config.environment}-${config.aws.account.target}`,
            key: `tf-state/${config.serviceName}-${config.aws.account.target}-ecs.json`,
            region: config.aws.region,
        })

        const vpcData = getVpcParameters(this, config.secretsLocation.vpc)

        const deploymentParams = getDeploymentParameters(this, config.secretsLocation)

        const applicationSnsTopics = getApplicationSnsTopics(this, config)

        // Sync env variables
        this.syncEnvVariables(config)

        const exchangeApp = this.createApplication({
            config,
            vpcData,
            deploymentParams,
            applicationSnsTopics: applicationSnsTopics,
        })

        this.createApplicationCodePipeline(
            config,
            exchangeApp,
            applicationSnsTopics.deploymentSns.arn,
        )
    }

    private syncEnvVariables(config: ThalloApplicationConfig) {
        new S3Object(this, 'env_vars', {
            bucket: `thallo.env-vars.${config.serviceName}-${config.environment}-${config.aws.account.target}`, //Note production bucket is different
            key: `${config.environment}.env`,
            source: `${process.cwd()}/envs/${config.environment}.env`,
            etag: Fn.filemd5(`${process.cwd()}/envs/${config.environment}.env`),
        })
    }

    /**
     * Create CodePipeline to deploy ecs
     */
    private createApplicationCodePipeline(
        config: ThalloApplicationConfig,
        app: ThalloAlbApplication,
        snsTopicArn: string,
    ) {
        new ThalloECSCodePipeline(this, `${config.serviceName}_code_pipeline`, {
            pipelineName: `app-${config.environment}-${config.serviceName}`,
            serviceName: config.serviceName,
            environment: config.environment,
            artifactBucketPrefix: `codepipeline.${config.environment}`,
            source: {
                sourceBucket: app.ecsArtifactBucket,
                imageRepositoryArn: config.codePipeline.application.imageRepositoryArn,
                imageRepositoryName: config.codePipeline.application.imageRepositoryName,
                imageTag: config.codePipeline.application.imageTag,
            },
            codebuild: {
                image: config.codePipeline.codeBuild.image,
            },
            snsNotificationTopicArn: snsTopicArn,
        })
    }

    private createApplication(dependencies: {
        config: ThalloApplicationConfig
        vpcData: VpcData
        deploymentParams: DeploymentParameters
        applicationSnsTopics: ApplicationSnsTopics
    }): ThalloAlbApplication {
        const { config, vpcData, deploymentParams, applicationSnsTopics } = dependencies
        return new ThalloAlbApplication(this, 'exchange_be', {
            environment: config.environment,
            awsProfile: config.aws.profile,
            codeDeploy: {
                useCodeDeploy: true,
                useCodePipeline: true,
                snsNotificationTopicArn: dependencies.applicationSnsTopics.deploymentSns.arn,
                notifications: {
                    notifyOnStart: false,
                    notifyOnSuccess: false,
                    notifyOnFailure: true,
                },
            },
            region: config.aws.region,
            serviceName: config.serviceName,
            alb6CharacterPrefix: config.shortName,
            tags: config.tags,
            domain: config.dns.fullDomain,
            baseHostedZoneId: config.dns.hostedZoneId,
            vpcConfig: vpcData,
            wafEnabled: true,
            runDbMigration: true,
            containerConfigs: [
                {
                    name: `${config.serviceName}`,
                    containerImage: config.application.imageUrl,
                    portMappings: [
                        {
                            containerPort: config.application.port,
                            hostPort: config.application.port,
                        },
                    ],
                    envVars: [
                        // Common env vars
                        {
                            name: 'ENV',
                            value: `${config.environment}`,
                        },
                        {
                            name: 'AWS_REGION',
                            value: `${config.aws.region}`,
                        },
                        {
                            name: 'PORT',
                            value: `${config.application.port}`,
                        },
                        {
                            name: 'POSTGRES_PORT',
                            value: `${config.database.port}`,
                        },
                        {
                            name: 'POSTGRES_USER',
                            value: `${config.database.masterUsername}`,
                        },
                        {
                            name: 'POSTGRES_DATABASE',
                            value: `${config.database.name}`,
                        },
                    ],
                    envFiles: [
                        {
                            type: 's3',
                            value: `arn:aws:s3:::thallo.env-vars.${config.serviceName}-${config.environment}-${config.aws.account.target}/${config.environment}.env`,
                        },
                    ],
                    secretEnvVars: [
                        /**
                         * Components parameters.
                         */
          
                        
                        /**
                         * ECS application parameters.
                         */
                    ],
                    healthCheck: {
                        command: [
                            'CMD-SHELL',
                            `curl -s http://localhost:${config.application.port}/ || exit 1`,
                        ],
                        interval: 10,
                        timeout: 5,
                        retries: 3,
                        startPeriod: 5,
                    },
                },
            ],

            exposedContainer: {
                name: `${config.serviceName}`,
                port: config.application.port,
                healthCheckPath: '/health',
            },

            ecsIamConfig: {
                prefix: config.serviceName,
                taskExecutionRolePolicyStatements: [
                    {
                        actions: ['secretsmanager:GetSecretValue', 'kms:Decrypt'],
                        resources: [
                            deploymentParams.deploymentSecret.arn,
                            deploymentParams.rdsSecret.arn,
                            deploymentParams.bucketSecret.arn,
                        ],
                        effect: 'Allow',
                    },
                    {
                        actions: ['s3:GetObject', 's3:GetBucketLocation'],
                        resources: [
                            `arn:aws:s3:::thallo.env-vars.${config.serviceName}-${config.environment}-${config.aws.account.target}`,
                            `arn:aws:s3:::thallo.env-vars.${config.serviceName}-${config.environment}-${config.aws.account.target}/*`,
                        ],
                        effect: 'Allow',
                    },
                ],
                taskRolePolicyStatements: [
                    {
                        actions: ['s3:ListAllMyBuckets', 's3:ListBucket'],
                        resources: ['*'],
                        effect: 'Allow',
                    },
                    {
                        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
                        resources: [
                            `*`,
                            `arn:aws:ses:${config.aws.region}:${config.aws.account.sharedServices}:identity/*`,
                        ],
                    },
                ],
                taskExecutionDefaultAttachmentArn:
                    'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
            },
            autoscalingConfig: {
                targetMinCapacity: 2,
                targetMaxCapacity: 10,
            },
            alarms: {
                http5xxErrorPercentage: {
                    threshold: 1,
                    evaluationPeriods: 4,
                    period: 60,
                    actions: [applicationSnsTopics.criticalAlarmsSns.arn],
                },
                httpLatency: {
                    threshold: 1000,
                    evaluationPeriods: 4,
                    period: 60,
                    actions: [applicationSnsTopics.criticalAlarmsSns.arn],
                },
                route53HealthCheck: {
                    threshold: 1,
                    evaluationPeriods: 1,
                    period: 60,
                    actions: [applicationSnsTopics.criticalAlarmsSnsUsEast1.arn],
                },
            },
        })
    }
}
