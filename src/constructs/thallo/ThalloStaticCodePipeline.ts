import { Environment, ThalloService } from './ThalloApplicationConfig'
import {
    CodepipelineStage,
    Codepipeline,
    CodepipelineArtifactStore,
    CodepipelineStageAction,
} from '@cdktf/provider-aws/lib/codepipeline'
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document'
import { IamRole } from '@cdktf/provider-aws/lib/iam-role'
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket'
import { S3BucketPublicAccessBlock } from '@cdktf/provider-aws/lib/s3-bucket-public-access-block'
import { Fn, TerraformMetaArguments } from 'cdktf'
import { Construct } from 'constructs/lib'
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy'
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity'
import { CodestarnotificationsNotificationRule } from '@cdktf/provider-aws/lib/codestarnotifications-notification-rule'
import { S3BucketVersioningA } from '@cdktf/provider-aws/lib/s3-bucket-versioning'
import { S3Object } from '@cdktf/provider-aws/lib/s3-object'
import { ThalloCodeBuildProject } from './ThalloCodeBuildProject'
import path = require('path')

export interface ThalloStaticCodePipelineProps extends TerraformMetaArguments {
    serviceName: ThalloService
    environment: Environment
    artifactBucketPrefix: string
    source: {
        websiteBucket: S3Bucket
        gitRepositoryName: string
        branchName: string
        codeStarConnectionArn: string
    }
    codebuild: {
        image: string
    }
    snsNotificationTopicArn?: string
    // Optional list of stages to run before the deploy stage
    preDeployStages?: CodepipelineStage[]
    // Optional list of stages to run after the deploy stage
    postDeployStages?: CodepipelineStage[]
    tags?: { [key: string]: string }
}

export class ThalloStaticCodePipeline extends Construct {
    public readonly codePipeline: Codepipeline
    public readonly stages: CodepipelineStage[]
    public readonly pipelineName: string
    private readonly pipelineArtifactBucket: S3Bucket
    private readonly pipelineRole: IamRole
    private readonly buildApplicationCodeBuildProjectName: string
    private readonly invalidateCdnCodeBuildProjectName: string

    private readonly caller: DataAwsCallerIdentity

    constructor(scope: Construct, id: string, private config: ThalloStaticCodePipelineProps) {
        super(scope, id)

        this.caller = new DataAwsCallerIdentity(this, 'caller_identity', {})

        this.pipelineName = this.getPipelineName()

        const buildSpecFilesBucket = this.createUploadBuildSpecFilesToS3()

        this.buildApplicationCodeBuildProjectName = this.getBuildApplicationProject(
            buildSpecFilesBucket,
            'buildspec_build_static_app.yml', // TODO: this is hardcoded in three places... fix this
        ).codeBuildProject.name

        this.invalidateCdnCodeBuildProjectName = this.getInvalidateCdnCacheProject(
            buildSpecFilesBucket,
            'buildspec_invalidate_cdn_cache.yml', // TODO: this is hardcoded in three places... fix this
        ).codeBuildProject.name

        this.stages = this.getStages()

        this.pipelineArtifactBucket = this.createArtifactBucket()

        this.pipelineRole = this.createPipelineRole()
        this.codePipeline = this.createCodePipeline()
    }

    private getPipelineName = (): string =>
        `app-${this.config.environment}-${this.config.serviceName}`

    /*
     * Get all stages for the pipeline, including postDeployStage if provided
     */
    private getStages = () => [
        this.getSourceStage(),
        ...(this.config.preDeployStages ? this.config.preDeployStages : []),
        this.getDeployStage(),
        ...(this.config.postDeployStages ? this.config.postDeployStages : []),
    ]

    private createArtifactBucket(): S3Bucket {
        const artifactBucket = new S3Bucket(this, 'artifact_bucket', {
            bucket: `codepipeline.${this.config.serviceName}.${this.config.environment}-${this.caller.accountId}`,
            forceDestroy: true,
            tags: this.config.tags,
            provider: this.config.provider,
        })

        new S3BucketPublicAccessBlock(this, 's3_bucket_public_access_block', {
            bucket: artifactBucket.id,
            blockPublicAcls: true,
            blockPublicPolicy: true,
            ignorePublicAcls: true,
            restrictPublicBuckets: true,
        })

        return artifactBucket
    }

    private getArtifactStore = (): CodepipelineArtifactStore[] => [
        {
            type: 'S3',
            location: this.pipelineArtifactBucket.bucket,
        },
    ]

    private createCodePipeline(): Codepipeline {
        const pipeline = new Codepipeline(this, 'code_pipeline', {
            name: this.pipelineName,
            roleArn: this.pipelineRole.arn,
            artifactStore: this.getArtifactStore(),
            stage: this.getStages(),
            tags: this.config.tags,
            provider: this.config.provider,
        })

        if (this.config.snsNotificationTopicArn) {
            new CodestarnotificationsNotificationRule(this, 'notification_rule', {
                name: `${this.pipelineName}-${this.caller.accountId}`,
                detailType: 'FULL',
                resource: pipeline.arn,
                eventTypeIds: [
                    'codepipeline-pipeline-action-execution-failed',
                    'codepipeline-pipeline-action-execution-canceled',

                    'codepipeline-pipeline-pipeline-execution-started',
                    'codepipeline-pipeline-pipeline-execution-resumed',
                    'codepipeline-pipeline-pipeline-execution-succeeded',
                    'codepipeline-pipeline-pipeline-execution-superseded',

                    'codepipeline-pipeline-manual-approval-failed',
                    'codepipeline-pipeline-manual-approval-needed',
                    'codepipeline-pipeline-manual-approval-succeeded',
                ],
                target: [
                    {
                        type: 'SNS',
                        address: this.config.snsNotificationTopicArn,
                    },
                ],
                tags: this.config.tags,
                provider: this.config.provider,
            })
        }
        return pipeline
    }

    private createPipelineRole(): IamRole {
        const codepipelineRole = new IamRole(this, 'code_pipeline_role', {
            name: `${this.pipelineName}-code_pipeline_role`,
            assumeRolePolicy: new DataAwsIamPolicyDocument(
                this,
                'code_pipeline_assume_role_policy',
                {
                    statement: [
                        {
                            effect: 'Allow',
                            actions: ['sts:AssumeRole'],
                            principals: [
                                {
                                    identifiers: ['codepipeline.amazonaws.com'],
                                    type: 'Service',
                                },
                            ],
                        },
                    ],
                    provider: this.config.provider,
                },
            ).json,
        })

        new IamRolePolicy(this, 'codepipeline_role_policy', {
            name: `${this.pipelineName}-codepipeline_role_policy`,
            role: codepipelineRole.id,
            policy: new DataAwsIamPolicyDocument(this, 'codepipeline_role_policy_document', {
                statement: [
                    {
                        effect: 'Allow',
                        actions: ['codestar-connections:UseConnection'],
                        resources: [this.config.source.codeStarConnectionArn],
                    },
                    {
                        effect: 'Allow',
                        actions: [
                            'codebuild:BatchGetBuilds',
                            'codebuild:StartBuild',
                            'codebuild:BatchGetBuildBatches',
                            'codebuild:StartBuildBatch',
                        ],
                        resources: [
                            // The `*` allows CodeBuild in `preDeployStages` and
                            // `postDeployStages` to start, if project starts with `this.config.prefix`
                            `arn:aws:codebuild:*:*:project/${this.buildApplicationCodeBuildProjectName}*`,
                            `arn:aws:codebuild:*:*:project/${this.invalidateCdnCodeBuildProjectName}*`,
                        ],
                    },
                    {
                        effect: 'Allow',
                        actions: [
                            's3:GetObject',
                            's3:GetObjectVersion',
                            's3:GetBucketVersioning',
                            's3:PutObjectAcl',
                            's3:PutObject',
                        ],
                        resources: ['*'],
                    },
                    {
                        effect: 'Allow',
                        actions: ['iam:PassRole'],
                        resources: ['*'],
                        condition: [
                            {
                                variable: 'iam:PassedToService',
                                test: 'StringEqualsIfExists',
                                values: ['ecs-tasks.amazonaws.com'],
                            },
                        ],
                    },
                ],
                provider: this.config.provider,
            }).json,
        })
        return codepipelineRole
    }

    /**
     * CodeBuild projects
     */

    // Upload buildspec_build_static_app.yml and buildspec_invalidate_cdn_cache.yml
    private createUploadBuildSpecFilesToS3 = (): S3Bucket => {
        const bucket = new S3Bucket(this, 'codebuild_s3_bucket', {
            bucket: `codebuild.${this.config.serviceName}.${this.config.environment}-${this.caller.accountId}`,
            tags: this.config.tags,
        })

        new S3BucketVersioningA(this, 'codebuild_bucket_versioning', {
            bucket: bucket.id,
            versioningConfiguration: { status: 'Enabled' },
        })

        new S3BucketPublicAccessBlock(this, 'codebuild_bucket_public_access_block', {
            bucket: bucket.id,
            blockPublicAcls: true,
            blockPublicPolicy: true,
            ignorePublicAcls: true,
            restrictPublicBuckets: true,
        })

        this.uploadFileToS3({
            fileName: 'buildspec_build_static_app',
            filePath: path.resolve(
                __dirname,
                '../../../config/buildspec/app/buildspec_build_static_app.yml',
            ),
            bucket,
        })

        this.uploadFileToS3({
            fileName: 'buildspec_invalidate_cdn_cache',
            filePath: path.resolve(
                __dirname,
                '../../../config/buildspec/app/buildspec_invalidate_cdn_cache.yml',
            ),
            bucket,
        })

        return bucket
    }

    private uploadFileToS3(props: {
        fileName: string
        filePath: string
        bucket: S3Bucket
    }): S3Object {
        return new S3Object(this, props.fileName, {
            bucket: props.bucket.id,
            key: `${props.fileName}.yml`,
            etag: Fn.filemd5(props.filePath),
            source: props.filePath,
        })
    }

    private getBuildApplicationProject = (
        buildSpecFileBucket: S3Bucket,
        buildSpecFileName: string,
    ): ThalloCodeBuildProject => {
        return new ThalloCodeBuildProject(this, 'codebuild_project_build_static', {
            name: `${this.pipelineName}-build-application`,
            buildSpecFilePath: `${buildSpecFileBucket.arn}/${buildSpecFileName}`,
            environment: {
                imagePullCredentialsType: 'SERVICE_ROLE',
                computeType: 'BUILD_GENERAL1_SMALL',
                image: this.config.codebuild.image,
                environmentVariables: [
                    {
                        name: 'ENVIRONMENT',
                        value: this.config.environment,
                    },
                    { name: 'SERVICE', value: this.config.serviceName },
                ],
            },
            tags: this.config.tags,
            snsNotificationTopicArn: this.config.snsNotificationTopicArn,
        })
    }

    private getInvalidateCdnCacheProject = (
        buildSpecFileBucket: S3Bucket,
        buildSpecFileName: string,
    ): ThalloCodeBuildProject => {
        return new ThalloCodeBuildProject(this, 'codebuild_project_invalidate_cache', {
            name: `${this.pipelineName}-invalidate-cache`,
            buildSpecFilePath: `${buildSpecFileBucket.arn}/${buildSpecFileName}`,
            environment: {
                imagePullCredentialsType: 'SERVICE_ROLE',
                computeType: 'BUILD_GENERAL1_SMALL',
                image: this.config.codebuild.image,
                environmentVariables: [
                    {
                        name: 'NODE_ENV',
                        value: this.config.environment,
                    },
                    { name: 'AWS_ACCOUNT_ID', value: this.caller.accountId },
                ],
            },
            tags: this.config.tags,
            snsNotificationTopicArn: this.config.snsNotificationTopicArn,
        })
    }

    /**
     * Source Stage
     */

    private getSourceStage = (): CodepipelineStage => ({
        name: 'Source',
        action: [this.getSourceGithubCheckoutAction()],
    })

    private getSourceGithubCheckoutAction = (): CodepipelineStageAction => ({
        name: 'Github_Checkout',
        category: 'Source',
        owner: 'AWS',
        provider: 'CodeStarSourceConnection',
        inputArtifacts: [],
        outputArtifacts: ['SourceGithubArtifactOutput'],
        version: '1',
        configuration: {
            ConnectionArn: this.config.source.codeStarConnectionArn,
            FullRepositoryId: this.config.source.gitRepositoryName,
            BranchName: this.config.source.branchName,
            DetectChanges: 'true',
        },
        namespace: 'SourceVariables',
        runOrder: 1,
    })

    /**
     * Deploy Stage
     */
    private getDeployStage = (): CodepipelineStage => ({
        name: 'Deploy',
        action: [
            this.getBuildApplicationAction(),
            this.getDeployApplicationAction(),
            this.getInvalidateCdnCacheAction(),
        ],
    })

    private getBuildApplicationAction = (): CodepipelineStageAction => ({
        name: 'Build_Application',
        category: 'Build',
        owner: 'AWS',
        provider: 'CodeBuild',
        inputArtifacts: ['SourceGithubArtifactOutput'],
        outputArtifacts: ['BuildApplicationArtifactOutput'],
        version: '1',
        configuration: {
            ProjectName: this.buildApplicationCodeBuildProjectName,
            EnvironmentVariables: `[
                ${JSON.stringify({
                    name: 'GIT_BRANCH',
                    value: '#{SourceVariables.BranchName}',
                })}]`,
        },
        runOrder: 1,
    })

    private getDeployApplicationAction = (): CodepipelineStageAction => ({
        name: 'Deploy_Application_S3',
        category: 'Deploy',
        owner: 'AWS',
        provider: 'S3',
        inputArtifacts: ['BuildApplicationArtifactOutput'],
        version: '1',
        configuration: {
            BucketName: this.config.source.websiteBucket.id,
            Extract: 'true',
        },
        runOrder: 2,
    })

    private getInvalidateCdnCacheAction = (): CodepipelineStageAction => ({
        name: 'Invalidate_CDN_Cache',
        category: 'Build',
        owner: 'AWS',
        provider: 'CodeBuild',
        inputArtifacts: ['SourceGithubArtifactOutput'],
        version: '1',
        configuration: {
            ProjectName: this.invalidateCdnCodeBuildProjectName,
            EnvironmentVariables: `[
                ${JSON.stringify({
                    name: 'GIT_BRANCH',
                    value: '#{SourceVariables.BranchName}',
                })}]`,
        },
        runOrder: 3,
    })
}
