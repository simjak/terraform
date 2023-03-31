import {
    Environment,
    ThalloProduct,
    ThalloService,
} from './../../../../../constructs/thallo/ThalloApplicationConfig'
import { ThalloAccountRegistry } from '../../../../../constructs/thallo/ThalloAccountRegistry'
import { DataAwsCodestarconnectionsConnection } from '@cdktf/provider-aws/lib/data-aws-codestarconnections-connection'
import { ThalloCodeBuildProject } from '../../../../../constructs/thallo/ThalloCodeBuildProject'
import { CodebuildProject } from '@cdktf/provider-aws/lib/codebuild-project'
import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { S3Backend } from 'cdktf'
import { TerraformStack } from 'cdktf/lib/terraform-stack'
import { Construct } from 'constructs'
import { ThalloInfraCodePipeline } from '../../../../../constructs/thallo/ThalloInfraCodePipeline'
import { config } from '../../SharedConfig'
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket'
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity'
import { S3BucketVersioningA } from '@cdktf/provider-aws/lib/s3-bucket-versioning'
import { S3BucketPublicAccessBlock } from '@cdktf/provider-aws/lib/s3-bucket-public-access-block'
import {
    DataAwsIamPolicyDocument,
    DataAwsIamPolicyDocumentStatement,
} from '@cdktf/provider-aws/lib/data-aws-iam-policy-document'
import { S3BucketPolicy } from '@cdktf/provider-aws/lib/s3-bucket-policy'
import { DataAwsSnsTopic } from '@cdktf/provider-aws/lib/data-aws-sns-topic'
import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule'
import { IamRole } from '@cdktf/provider-aws/lib/iam-role'
import { Codepipeline } from '@cdktf/provider-aws/lib/codepipeline'
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy'
import { ApplicationEventBridgeRule } from '../../../../../constructs/base/ApplicationEventBridgeRule'

export class SharedCodePipelineStack extends TerraformStack {
    private readonly githubConnectionArn: string
    private readonly caller: DataAwsCallerIdentity
    constructor(scope: Construct, id: string) {
        super(scope, id)

        this.caller = new DataAwsCallerIdentity(this, 'caller', {})

        console.log(config.aws.local.profile)

        new AwsProvider(this, 'aws', {
            profile: config.aws.local.profile,
            region: config.aws.region,
            assumeRole: [
                {
                    roleArn: `arn:aws:iam::${ThalloAccountRegistry.infrastructure.sharedServices}:role/terraform-build-role`,
                },
            ],
        })

        new S3Backend(this, {
            profile: config.aws.local.profile,
            roleArn: `arn:aws:iam::${ThalloAccountRegistry.infrastructure.sharedServices}:role/terraform-build-role`,
            bucket: `tf-state.shared-${ThalloAccountRegistry.infrastructure.sharedServices}`,
            key: `tf-state/shared-${ThalloAccountRegistry.infrastructure.sharedServices}-codepipeline.json`,
            region: config.aws.region,
        })

        this.githubConnectionArn = this.getGithubConnectionArn()

        const snsNotificationTopicArn = this.getSnsTopic(
            config.codePipeline.snsNotificationTopicName,
        ).arn

        // Create the bucket to store the terraform repo
        const repoBucket = this.createTerraformRepoBucket()

        // CDKTF CodeBuild image build pipeline
        this.createCdktfImageBuildPipeline()

        // Terraform checkout pipeline
        this.createTerraformCheckoutPipeline(snsNotificationTopicArn)

        // Application infra pipelines

        /**
         * Staging
         */

        const remoteEnvironmentData = {
            exchange: [
                // Staging
                {
                    environment: Environment.STAGING,
                    product: ThalloProduct.EXCHANGE,
                    service: ThalloService.EXCHANGE_BE,
                },
                {
                    environment: Environment.STAGING,
                    product: ThalloProduct.EXCHANGE,
                    service: ThalloService.EXCHANGE_FE,
                },
                // Demo
                {
                    environment: Environment.DEMO,
                    product: ThalloProduct.EXCHANGE,
                    service: ThalloService.EXCHANGE_BE,
                },
                {
                    environment: Environment.DEMO,
                    product: ThalloProduct.EXCHANGE,
                    service: ThalloService.EXCHANGE_FE,
                },
            ],
        }

        remoteEnvironmentData.exchange.forEach((remoteEnvironment) => {
            this.createTerraformDeploymentPipeline(
                remoteEnvironment.environment,
                remoteEnvironment.service,
                remoteEnvironment.product,
                repoBucket,
                snsNotificationTopicArn,
            )
        })

        /**
         * Production
         */

        const remoteProductionEnvironmentData = {
            exchange: [
                {
                    environment: Environment.PRODUCTION,
                    product: ThalloProduct.EXCHANGE,
                    service: ThalloService.EXCHANGE_BE,
                },
            ],
        }

        remoteProductionEnvironmentData.exchange.forEach((remoteEnvironment) => {
            this.createTerraformDeploymentPipeline(
                remoteEnvironment.environment,
                remoteEnvironment.service,
                remoteEnvironment.product,
                repoBucket,
            )
        })
    }

    private getSnsTopic(snsTopicName: string): DataAwsSnsTopic {
        return new DataAwsSnsTopic(this, snsTopicName, {
            name: snsTopicName,
        })
    }

    /*
    Connect to Github
    */
    private getGithubConnectionArn(): string {
        return new DataAwsCodestarconnectionsConnection(this, 'github-connection', {
            name: config.codePipeline.githubConnectionName,
        }).arn
    }

    /*
     * Buckets
     */

    private createTerraformRepoBucket(): S3Bucket {
        const bucket = new S3Bucket(this, `tf_repo_bucket`, {
            bucket: `repo.terraform-${this.caller.accountId}`,
            forceDestroy: true,
            tags: {
                service: `shared-services`,
                environment: `shared`,
            },
        })

        new S3BucketVersioningA(this, 's3_bucket_versioning', {
            bucket: bucket.id,
            versioningConfiguration: { status: 'Enabled' },
        })

        new S3BucketPublicAccessBlock(this, 's3_bucket_public_access_block', {
            bucket: bucket.id,
            blockPublicAcls: true,
            blockPublicPolicy: true,
            ignorePublicAcls: true,
            restrictPublicBuckets: true,
        })

        new S3BucketPolicy(this, 's3_bucket_policy', {
            bucket: bucket.id,
            policy: new DataAwsIamPolicyDocument(this, 's3_bucket_policy_document', {
                statement: [
                    {
                        actions: ['s3:*'],
                        effect: 'Allow',
                        principals: [
                            {
                                identifiers: [
                                    `arn:aws:iam::${ThalloAccountRegistry.infrastructure.sharedServices}:role/terraform-build-role`,
                                ],
                                type: 'AWS',
                            },
                        ],
                        resources: [`${bucket.arn}/*`],
                    },
                ],
            }).json,
        })

        return bucket
    }

    /*
     * CodeBuild projects
     */

    private createTerraformApplyCodeBuildProject(props: {
        buildName: string
        environment: Environment
        serviceName: ThalloService
        buildSpecFilePath: string
        codeBuildRolePolicyStatements?: DataAwsIamPolicyDocumentStatement[]
        snsNotificationTopicArn?: string
    }): CodebuildProject {
        return new ThalloCodeBuildProject(this, `codebuild_${props.buildName}`, {
            name: props.buildName,
            buildSpecFilePath: props.buildSpecFilePath,
            environment: {
                imagePullCredentialsType: 'SERVICE_ROLE',
                computeType: 'BUILD_GENERAL1_SMALL',
                image: config.codePipeline.codeBuild.image,
                environmentVariables: [
                    { name: 'AWS_ACCOUNT_ID', value: this.caller.accountId },
                    {
                        name: 'ENVIRONMENT',
                        value: props.environment,
                    },
                    {
                        name: 'SERVICE',
                        value: props.serviceName,
                    },
                ],
            },
            codeBuildRolePolicyStatements: props.codeBuildRolePolicyStatements,
            snsNotificationTopicArn: props.snsNotificationTopicArn,
            tags: config.tags,
        }).codeBuildProject
    }

    private createTerraformCheckoutCodeBuildProject(props: {
        buildName: string
        buildSpecFilePath: string
        codeBuildRolePolicyStatements?: DataAwsIamPolicyDocumentStatement[]
        snsNotificationTopicArn?: string
    }): CodebuildProject {
        return new ThalloCodeBuildProject(this, `codebuild_${props.buildName}`, {
            name: props.buildName,
            buildSpecFilePath: props.buildSpecFilePath,
            environment: {
                imagePullCredentialsType: 'SERVICE_ROLE',
                computeType: 'BUILD_GENERAL1_SMALL',
                image: config.codePipeline.codeBuild.image,
                environmentVariables: [{ name: 'AWS_ACCOUNT_ID', value: this.caller.accountId }],
            },
            codeBuildRolePolicyStatements: props.codeBuildRolePolicyStatements,
            snsNotificationTopicArn: props.snsNotificationTopicArn,
            tags: config.tags,
        }).codeBuildProject
    }

    /*
     * CodePipelines
     */
    private createTerraformCheckoutPipeline(
        snsNotificationTopicArn?: string,
    ): ThalloInfraCodePipeline {
        const codebuildTfCheckout = this.createTerraformCheckoutCodeBuildProject({
            buildName: `terraform-repo-checkout-to-s3`,
            buildSpecFilePath: `config/buildspec/infra/buildspec_checkout.yml`,
            snsNotificationTopicArn: snsNotificationTopicArn,
        })

        const pipeline = new ThalloInfraCodePipeline(this, 'codepipeline', {
            name: 'infra-shared-terraform-checkout-s3',
            snsNotificationTopicArn: snsNotificationTopicArn,
            sourceStage: {
                name: 'Source',
                action: [
                    {
                        name: 'Github_checkout',
                        version: '1',
                        category: 'Source',
                        owner: 'AWS',
                        provider: 'CodeStarSourceConnection',
                        outputArtifacts: ['SourceGithubArtifactOutput'],
                        configuration: {
                            ConnectionArn: this.githubConnectionArn,
                            FullRepositoryId: 'thallo-io/terraform',
                            BranchName: 'beta', // change to main or main when ready
                            OutputArtifactFormat: 'CODEBUILD_CLONE_REF',
                            DetectChanges: 'true',
                        },
                        runOrder: 1,
                    },
                ],
            },
            deployStage: {
                name: 'Deploy',
                action: [
                    {
                        name: 'Deploy_to_S3',
                        version: '1',
                        category: 'Build',
                        owner: 'AWS',
                        provider: 'CodeBuild',
                        inputArtifacts: ['SourceGithubArtifactOutput'],
                        outputArtifacts: [],
                        configuration: {
                            ProjectName: codebuildTfCheckout.name,
                            PrimarySource: 'SourceGithubArtifactOutput',
                            EnvironmentVariables: `[]`,
                        },
                        runOrder: 1,
                    },
                ],
            },
            codepipelineRolePolicyStatements: [
                {
                    effect: 'Allow',
                    actions: ['codestar-connections:UseConnection'],
                    resources: [this.githubConnectionArn],
                },
                {
                    effect: 'Allow',
                    actions: ['lambda:InvokeFunction'],
                    resources: ['*'],
                },
            ],
        })
        return pipeline
    }

    /*
        Deploy the terraform code to the environment
     */

    private createTerraformDeploymentPipeline(
        environment: Environment,
        serviceName: ThalloService,
        productName: ThalloProduct,
        repositoryBucket: S3Bucket,
        snsNotificationTopicArn?: string,
    ): ThalloInfraCodePipeline {
        // const codebuildTfCheckovScan = 'TODO'
        const codeBuildRolePolicyStatements: DataAwsIamPolicyDocumentStatement[] = [
            {
                effect: 'Allow',
                actions: ['sts:AssumeRole'],
                resources: [
                    `arn:aws:iam::${ThalloAccountRegistry.workloads[environment][productName]}:role/terraform-build-role`,
                ],
            },
        ]

        const codeBuildTfApply = this.createTerraformApplyCodeBuildProject({
            environment: environment,
            serviceName: serviceName,
            buildName: `terraform-apply-${environment}-${serviceName}`,
            buildSpecFilePath: `config/buildspec/infra/buildspec_apply_${serviceName}.yml`,
            codeBuildRolePolicyStatements: codeBuildRolePolicyStatements,
            snsNotificationTopicArn: snsNotificationTopicArn,
        })

        const pipeline = new ThalloInfraCodePipeline(
            this,
            `codepipeline-infra-${environment}-${serviceName}`,
            {
                name: `infra-${environment}-${serviceName}`,
                snsNotificationTopicArn: snsNotificationTopicArn,
                sourceStage: {
                    name: 'Source',
                    action: [
                        {
                            name: 'S3_checkout',
                            version: '1',
                            category: 'Source',
                            owner: 'AWS',
                            provider: 'S3',
                            outputArtifacts: ['SourceS3ArtifactOutput'],
                            region: config.aws.region,
                            configuration: {
                                S3Bucket: repositoryBucket.id,
                                S3ObjectKey: `${environment}/${serviceName}/version.zip`,
                                PollForSourceChanges: 'false',
                            },
                            runOrder: 1,
                        },
                    ],
                },
                deployStage: {
                    name: 'Deploy',
                    action: [
                        {
                            name: 'Terraform_apply',
                            version: '1',
                            category: 'Build',
                            owner: 'AWS',
                            provider: 'CodeBuild',
                            inputArtifacts: ['SourceS3ArtifactOutput'],
                            outputArtifacts: [],
                            configuration: {
                                ProjectName: codeBuildTfApply.name,
                                EnvironmentVariables: `[]`,
                            },
                            runOrder: 1,
                        },
                    ],
                },
                codepipelineRolePolicyStatements: [
                    {
                        effect: 'Allow',
                        actions: ['s3:Get*', 's3:List*', 's3:PutObject'],
                        resources: [repositoryBucket.arn, `${repositoryBucket.arn}/*`],
                    },
                ],
            },
        )
        this.createS3EventRule(pipeline.codePipeline, environment, serviceName, repositoryBucket)

        return pipeline
    }

    /*
     * CDKTF Image Build pipeline
     */

    private createCdktfImageBuildPipeline(): ThalloInfraCodePipeline {
        const codebuildProject = new ThalloCodeBuildProject(this, 'cdk_codebuild_project', {
            name: `cdktf-image-build`,
            buildSpecFilePath: 'config/buildspec/infra/buildspec_cdktf_image.yml',
            environment: {
                computeType: 'BUILD_GENERAL1_SMALL',
                environmentVariables: [
                    { name: 'AWS_DEFAULT_REGION', value: 'eu-west-1' },
                    { name: 'AWS_ACCOUNT_ID', value: this.caller.accountId },
                    {
                        name: 'REPOSITORY_URI',
                        value: `${this.caller.accountId}.dkr.ecr.eu-west-1.amazonaws.com`,
                    },
                    { name: 'IMAGE_REPO_NAME', value: 'cdktf-codebuild' },
                    { name: 'IMAGE_TAG', value: 'main' },
                ],
                privilegedMode: true,
            },
        })

        return new ThalloInfraCodePipeline(this, `${config.prefix}_code_pipeline`, {
            name: 'infra-shared-cdktf-image-build',
            sourceStage: {
                name: 'Source',
                action: [
                    {
                        name: 'Github_checkout',
                        version: '1',
                        category: 'Source',
                        owner: 'AWS',
                        provider: 'CodeStarSourceConnection',
                        outputArtifacts: ['SourceGithubArtifactOutput'],
                        configuration: {
                            ConnectionArn: this.githubConnectionArn,
                            FullRepositoryId: 'thallo-io/terraform',
                            BranchName: 'main',
                            OutputArtifactFormat: 'CODEBUILD_CLONE_REF',
                            DetectChanges: 'false',
                        },
                        runOrder: 1,
                    },
                ],
            },
            deployStage: {
                name: 'Deploy',
                action: [
                    {
                        name: 'Build_image',
                        version: '1',
                        category: 'Build',
                        owner: 'AWS',
                        provider: 'CodeBuild',
                        inputArtifacts: ['SourceGithubArtifactOutput'],
                        outputArtifacts: [],
                        configuration: {
                            ProjectName: codebuildProject.codeBuildProject.name,
                            PrimarySource: 'SourceGithubArtifactOutput',
                            EnvironmentVariables: `[]`,
                        },
                        runOrder: 1,
                    },
                ],
            },
            codepipelineRolePolicyStatements: [
                {
                    effect: 'Allow',
                    actions: ['codestar-connections:UseConnection'],
                    resources: [this.githubConnectionArn],
                },
            ],
        })
    }

    private createS3EventRule(
        pipeline: Codepipeline,
        environment: Environment,
        serviceName: ThalloService,
        repositoryBucket: S3Bucket,
    ): CloudwatchEventRule {
        const eventBridgeInvokeCodePipelineRole = new IamRole(
            this,
            `${serviceName}-${environment}-eventbridge_codepipeline_role`,
            {
                name: `${pipeline.name}-eventbridge_codepipeline_role`,
                assumeRolePolicy: new DataAwsIamPolicyDocument(
                    this,
                    `${serviceName}-${environment}-eventbridge_invoke_code_pipeline_role_assume_role_policy`,
                    {
                        statement: [
                            {
                                effect: 'Allow',
                                actions: ['sts:AssumeRole'],
                                principals: [
                                    {
                                        identifiers: ['events.amazonaws.com'],
                                        type: 'Service',
                                    },
                                ],
                            },
                        ],
                    },
                ).json,
            },
        )

        new IamRolePolicy(
            this,
            `${serviceName}-${environment}event_bridge_invoke_code_pipeline_role_policy`,
            {
                name: `${pipeline.name}-event_bridge_invoke_code_pipeline_role_policy`,
                role: eventBridgeInvokeCodePipelineRole.id,
                policy: new DataAwsIamPolicyDocument(
                    this,
                    `${serviceName}-${environment}-eventbridge_invoke_code_pipeline_role_policy_document`,
                    {
                        statement: [
                            {
                                effect: 'Allow',
                                actions: ['codepipeline:StartPipelineExecution'],
                                resources: [pipeline.arn],
                            },
                        ],
                    },
                ).json,
            },
        )

        return new ApplicationEventBridgeRule(this, `${serviceName}-${environment}s3_event_rule`, {
            name: `${pipeline.name}-s3_codepipeline_event_rule`,
            description: 'S3.PutObject for CodePipeline source file',
            roleArn: eventBridgeInvokeCodePipelineRole.arn,
            eventPattern: {
                // detailType: ['AWS API Call via CloudTrail'],
                detail: {
                    eventSource: ['s3.amazonaws.com'],
                    eventName: ['PutObject'],
                    requestParameters: {
                        bucketName: [repositoryBucket.id],
                        key: [`${environment}/${serviceName}/version.zip`],
                    },
                },
                source: ['aws.s3'],
            },
            targets: [
                {
                    targetId: 'codepipeline',
                    arn: pipeline.arn,
                },
            ],
        }).rule
    }
}
