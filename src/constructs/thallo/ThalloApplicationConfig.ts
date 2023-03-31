import { DataAwsSecretsmanagerSecret } from '@cdktf/provider-aws/lib/data-aws-secretsmanager-secret'
import { DataAwsSecretsmanagerSecretVersion } from '@cdktf/provider-aws/lib/data-aws-secretsmanager-secret-version'
import { DataAwsSnsTopic } from '@cdktf/provider-aws/lib/data-aws-sns-topic'
import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { Fn } from 'cdktf'
import { Construct } from 'constructs'
import { readJSONSecretKey } from '../../utils/utils'
import { ThalloAccountRegistry } from './ThalloAccountRegistry'
import { VpcData } from './ThalloVpc'

export enum ThalloService {
    BRIDGE_BE = 'bridge-be',
    BRIDGE_BE_ASYNC = 'bridge-be-async-processor',
    EXCHANGE_BE = 'exchange-be',
    EXCHANGE_FE = 'exchange-fe',
}

export enum ThalloProduct {
    BRIDGE = 'bridge',
    EXCHANGE = 'exchange',
}

export enum Environment {
    PRODUCTION = 'production',
    STAGING = 'staging',
    DEMO = 'demo',
    DEVELOPMENT = 'development',
    SEC_AUDIT = 'secaudit',
}

export enum DeploymentMode {
    LOCAL = 'local',
    REMOTE = 'remote',
    APPLICATION = 'application',
}

export interface ApplicationSnsTopics {
    deploymentSns: DataAwsSnsTopic
    criticalAlarmsSns: DataAwsSnsTopic
    criticalAlarmsSnsUsEast1: DataAwsSnsTopic
    nonCriticalAlarmsSns: DataAwsSnsTopic
}

interface hostedZone {
    name: string
    id?: string
}

export interface DeploymentParameters {
    deploymentSecret: DataAwsSecretsmanagerSecretVersion
    fireblocksSecret?: DataAwsSecretsmanagerSecretVersion
    bucketSecret: DataAwsSecretsmanagerSecretVersion
    rdsSecret: DataAwsSecretsmanagerSecretVersion
    sqsSecret?: DataAwsSecretsmanagerSecretVersion
}

interface SecretsLocation {
    deployment: string
    vpc: string
    rds: string
    fireblocks?: string
    sqs?: string
    bucket: string
}

export interface ThalloApplicationConfigInput {
    productName: ThalloProduct
    serviceName: ThalloService
    domainPrefix: string
    shortName: string
    deploymentMode: DeploymentMode
    environment: Environment
    aws: {
        profile?: string
    }
    application: {
        imageTag: string
        port: number
    }
    database: {
        name: string
        masterUsername: string
        port: number
    }
    secretsLocation: SecretsLocation
    tags: { [key: string]: string }
}

export interface ThalloApplicationConfig {
    productName: ThalloProduct
    serviceName: ThalloService
    domainPrefix: string
    shortName: string
    deploymentMode: DeploymentMode
    environment: Environment
    aws: {
        region: string
        availabilityZones: string[]
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
    application: {
        imageUrl: string
        port: number
    }
    database: {
        name: string
        masterUsername: string
        port: number
        instanceClass?: string
    }
    codePipeline: {
        sourceBucketId: string
        application: {
            imageRepositoryName: string
            imageRepositoryArn: string
            imageTag: string
        }
        codeBuild: {
            image: string
        }
    }
    secretsLocation: SecretsLocation
    tags: { [key: string]: string }
}

export function createApplicationConfig(
    // scope: Construct,
    props: ThalloApplicationConfigInput,
): ThalloApplicationConfig {
    const region = 'eu-west-1'

    const availabilityZones = ['eu-west-1a', 'eu-west-1b']

    const sharedServicesAccount = ThalloAccountRegistry.infrastructure.sharedServices
    const targetAccount = getTargetAccount(props.environment, props.productName)

    const hostedZone = getHostedZone(props.environment)

    return {
        productName: props.productName,
        serviceName: props.serviceName,
        domainPrefix: props.domainPrefix,
        shortName: props.shortName,
        deploymentMode: props.deploymentMode,
        environment: props.environment,
        aws: {
            region: region,
            availabilityZones: availabilityZones,
            account: {
                sharedServices: sharedServicesAccount,
                target: targetAccount,
            },
            profile: props.aws.profile,
        },
        // vpc: getVpcParameters(scope, props.secretsLocation.vpc),
        dns: {
            rootDomain: hostedZone.name,
            fullDomain: `${props.domainPrefix}.${hostedZone.name}`,
        },
        application: {
            imageUrl: `${sharedServicesAccount}.dkr.ecr.eu-west-1.amazonaws.com/${props.serviceName}:${props.application.imageTag}`,
            port: props.application.port,
            // deploymentParameters: getDeploymentParameters(scope, props.secretsLocation),
        },
        database: {
            name: props.database.name,
            masterUsername: props.database.masterUsername,
            port: props.database.port,
            instanceClass:
                props.environment === Environment.PRODUCTION ? 'db.r5.large' : 'db.t3.medium',
        },
        codePipeline: {
            sourceBucketId: `ecs-artifacts.${props.serviceName}.${props.environment}-${targetAccount}`,
            application: {
                imageRepositoryName: props.serviceName,
                imageRepositoryArn: `arn:aws:ecr:eu-west-1:${ThalloAccountRegistry.infrastructure.sharedServices}:repository/${props.serviceName}`,
                imageTag: props.application.imageTag,
            },
            codeBuild: {
                image: `${sharedServicesAccount}.dkr.ecr.eu-west-1.amazonaws.com/cdktf-codebuild:main`,
            },
        },
        secretsLocation: props.secretsLocation,
        tags: props.tags,
    }
}

export function getHostedZone(environment: Environment): hostedZone {
    if (environment === Environment.PRODUCTION) {
        return {
            name: 'thallo.io',
        }
    } else {
        return {
            name: 'thallotest.com',
        }
    }
}

export function getTargetAccount(environment: Environment, productName: string): string {
    const targetAccounts: Record<string, Record<Environment, string>> = {
        exchange: {
            [Environment.PRODUCTION]: ThalloAccountRegistry.workloads.production.exchange,
            [Environment.STAGING]: ThalloAccountRegistry.workloads.staging.exchange,
            [Environment.DEVELOPMENT]: ThalloAccountRegistry.workloads.development.exchange,
            [Environment.SEC_AUDIT]: ThalloAccountRegistry.workloads.secaudit.exchange,
            [Environment.DEMO]: ThalloAccountRegistry.workloads.demo.exchange,
        },
        bridge: {
            [Environment.PRODUCTION]: ThalloAccountRegistry.workloads.production.bridge,
            [Environment.STAGING]: ThalloAccountRegistry.workloads.staging.bridge,
            [Environment.DEVELOPMENT]: ThalloAccountRegistry.workloads.development.bridge,
            [Environment.SEC_AUDIT]: ThalloAccountRegistry.workloads.secaudit.bridge,
            [Environment.DEMO]: 'Not implemented', // TODO: think how make it optional
        },
    }

    const targetAccount = targetAccounts[productName]?.[environment]

    if (targetAccount === undefined) {
        throw new Error(`No target account found for ${environment} and ${productName}`)
    }

    return targetAccount
}

export function getVpcParameters(scope: Construct, secretLocation: string): VpcData {
    const vpcSecret = new DataAwsSecretsmanagerSecret(scope, 'vpc_config', {
        name: `${secretLocation}`,
    })
    const vpcSecretVersion = new DataAwsSecretsmanagerSecretVersion(scope, 'vpc_config_value', {
        secretId: vpcSecret.arn,
    })

    const vpcId: string = readJSONSecretKey(vpcSecretVersion, 'vpcId')
    const publicSubnetIds: string[] = Fn.split(
        ',',
        readJSONSecretKey(vpcSecretVersion, 'publicSubnetIds'),
    )
    const privateSubnetIds: string[] = Fn.split(
        ',',
        readJSONSecretKey(vpcSecretVersion, 'backendPrivateSubnetIds'), // NOTE: This is the backend subnet ids, instead of private subnet ids
    )
    const processorPrivateSubnetIds: string[] = Fn.split(
        ',',
        readJSONSecretKey(vpcSecretVersion, 'processorPrivateSubnetIds'),
    )

    const databaseSubnetIds: string[] = Fn.split(
        ',',
        readJSONSecretKey(vpcSecretVersion, 'databaseSubnetIds'),
    )

    return {
        vpcId,
        publicSubnetIds,
        privateSubnetIds,
        processorPrivateSubnetIds: processorPrivateSubnetIds,
        databaseSubnetIds,
    }
}

/*
 * Fetch deployment parameters from secrets manager
 */

export function getDeploymentParameters(
    scope: Construct,
    secretsLocation: SecretsLocation,
): DeploymentParameters {
    /**
     * Application secrets
     */

    const deploymentSecret = new DataAwsSecretsmanagerSecret(scope, 'data_deployment_secret', {
        name: secretsLocation.deployment,
    })
    const deploymentSecretVersion = new DataAwsSecretsmanagerSecretVersion(
        scope,
        'deployment_secret_version',
        { secretId: deploymentSecret.arn },
    )

    /**
     * Components secrets
     */
    const bucketSecret = new DataAwsSecretsmanagerSecret(scope, 'data_bucket_secret', {
        name: secretsLocation.bucket,
    })
    const bucketSecretVersion = new DataAwsSecretsmanagerSecretVersion(
        scope,
        'data_bucket_secret_version',
        { secretId: bucketSecret.arn },
    )

    const rdsSecret = new DataAwsSecretsmanagerSecret(scope, 'data_rds_backend_secret', {
        name: secretsLocation.rds,
    })
    const rdsSecretVersion = new DataAwsSecretsmanagerSecretVersion(
        scope,
        'data_rds_secret_version',
        { secretId: rdsSecret.arn },
    )

    let sqsSecretVersion: DataAwsSecretsmanagerSecretVersion | undefined
    if (secretsLocation.sqs) {
        const sqsSecret = new DataAwsSecretsmanagerSecret(scope, 'data_sqs_secret', {
            name: secretsLocation.sqs,
        })
        sqsSecretVersion = new DataAwsSecretsmanagerSecretVersion(
            scope,
            'data_sqs_secret_version',
            { secretId: sqsSecret.arn },
        )
    }

    return {
        deploymentSecret: deploymentSecretVersion,
        bucketSecret: bucketSecretVersion,
        rdsSecret: rdsSecretVersion,
        sqsSecret: sqsSecretVersion,
    }
}

export function getApplicationSnsTopics(
    scope: Construct,
    config: ThalloApplicationConfig,
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
        alias: 'useast1',
        profile: config.aws.profile,
        assumeRole: [
            {
                roleArn: `arn:aws:iam::${config.aws.account.target}:role/terraform-build-role`,
            },
        ],
    })

    const criticalAlarmsSnsUsEast1 = new DataAwsSnsTopic(scope, 'data_cr_alarm_use1_sns_topic', {
        provider: providerUsEast1,
        name: `CriticalAlarms-${config.environment}-ChatBot`,
    })

    const nonCriticalAlarmsSns = new DataAwsSnsTopic(scope, 'data_non_cr_alarm_sns_topic', {
        name: `NonCriticalAlarms-${config.environment}-ChatBot`,
    })

    return { criticalAlarmsSns, criticalAlarmsSnsUsEast1, nonCriticalAlarmsSns, deploymentSns }
}
