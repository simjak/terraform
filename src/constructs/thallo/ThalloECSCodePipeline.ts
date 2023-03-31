import { ThalloCodeBuildProject } from './ThalloCodeBuildProject'
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
import { TerraformMetaArguments } from 'cdktf'
import { Construct } from 'constructs/lib'
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy'
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity'
import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule'
import { ApplicationEventBridgeRule } from '../base/ApplicationEventBridgeRule'
import { CodestarnotificationsNotificationRule } from '@cdktf/provider-aws/lib/codestarnotifications-notification-rule'
import { ThalloAccountRegistry } from './ThalloAccountRegistry'
import { DataAwsCloudwatchEventBus } from '@cdktf/provider-aws/lib/data-aws-cloudwatch-event-bus'
import { CloudwatchEventBusPolicy } from '@cdktf/provider-aws/lib/cloudwatch-event-bus-policy'

export interface ThalloECSCodePipelineProps extends TerraformMetaArguments {
    pipelineName: string
    serviceName: string
    artifactBucketPrefix: string
    environment: string
    source: {
        sourceBucket: S3Bucket
        imageRepositoryName: string
        imageRepositoryArn: string
        imageTag: string
    }
    codebuild: {
        image: string
    }
    codeDeploy?: {
        applicationName?: string
        deploymentGroupName?: string
        appSpecPath?: string
        taskDefPath?: string
    }
    useAsyncProcessing?: boolean
    snsNotificationTopicArn?: string
    // Optional list of stages to run before the deploy stage
    preDeployStages?: CodepipelineStage[]
    // Optional list of stages to run after the deploy stage
    postDeployStages?: CodepipelineStage[]
    tags?: { [key: string]: string }
}

export class ThalloECSCodePipeline extends Construct {
    public readonly codePipeline: Codepipeline
    public readonly stages: CodepipelineStage[]
    private readonly pipelineArtifactBucket: S3Bucket
    private readonly pipelineRole: IamRole

    private readonly dbMigrationCodebuildProjectName: string

    private readonly codeDeployApplicationName: string
    private readonly codeDeployDeploymentGroupName: string

    private readonly caller: DataAwsCallerIdentity

    constructor(scope: Construct, id: string, private config: ThalloECSCodePipelineProps) {
        super(scope, id)

        this.caller = new DataAwsCallerIdentity(this, 'caller_identity', {})

        this.dbMigrationCodebuildProjectName =
            this.getDbMigrationCodebuildProject().codeBuildProject.name
        this.codeDeployApplicationName = this.getCodeDeployApplicationName()
        this.codeDeployDeploymentGroupName = this.getCodeDeployDeploymentGroupName()
        this.stages = this.getStages()

        this.pipelineArtifactBucket = this.createArtifactBucket()
        this.pipelineRole = this.createPipelineRole()
        this.codePipeline = this.createCodePipeline()
        this.createEcrEventRule()
        this.createS3EventRule(this.codePipeline)
    }

    private getCodeDeployApplicationName = (): string =>
        this.config.codeDeploy?.applicationName ?? `${this.config.serviceName}-ECS`

    private getCodeDeployDeploymentGroupName = (): string =>
        this.config.codeDeploy?.deploymentGroupName ?? `${this.config.serviceName}-ECS`

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
        // const prefixHash = createHash('md5').update(this.config.prefix).digest('hex')

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
            name: this.config.pipelineName,
            roleArn: this.pipelineRole.arn,
            artifactStore: this.getArtifactStore(),
            stage: this.getStages(),
            tags: this.config.tags,
            provider: this.config.provider,
        })

        if (this.config.snsNotificationTopicArn) {
            new CodestarnotificationsNotificationRule(this, 'notification_rule', {
                name: `${this.config.pipelineName}-${this.config.environment}-${this.caller.accountId}-codepipeline`,
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
            name: `${this.config.pipelineName}-codepipeline_role`,
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
            name: `${this.config.pipelineName}-codepipeline_role_policy`,
            role: codepipelineRole.id,
            policy: new DataAwsIamPolicyDocument(this, 'codepipeline_role_policy_document', {
                statement: [
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
                            `arn:aws:codebuild:*:*:project/${this.dbMigrationCodebuildProjectName}*`,
                        ],
                    },
                    {
                        effect: 'Allow',
                        actions: [
                            'ecr:BatchCheckLayerAvailability',
                            'ecr:GetDownloadUrlForLayer',
                            'ecr:BatchGetImage',
                            'ecr:GetAuthorizationToken',
                            'ecr:DescribeImages',
                            'ecr:PutImage',
                        ],
                        resources: ['*'],
                    },
                    {
                        effect: 'Allow',
                        actions: [
                            'codedeploy:CreateDeployment',
                            'codedeploy:GetApplication',
                            'codedeploy:GetApplicationRevision',
                            'codedeploy:GetDeployment',
                            'codedeploy:RegisterApplicationRevision',
                            'codedeploy:GetDeploymentConfig',
                        ],
                        resources: [
                            `arn:aws:codedeploy:*:*:application:${this.codeDeployApplicationName}`,
                            `arn:aws:codedeploy:*:*:deploymentgroup:${this.codeDeployApplicationName}/${this.codeDeployDeploymentGroupName}`,
                            'arn:aws:codedeploy:*:*:deploymentconfig:*',
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
                        resources: [
                            this.pipelineArtifactBucket.arn,
                            `${this.pipelineArtifactBucket.arn}/*`,
                            this.config.source.sourceBucket.arn,
                            `${this.config.source.sourceBucket.arn}/*`,
                        ],
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
                    {
                        effect: 'Allow',
                        actions: [
                            'ecs:DescribeServices',
                            'ecs:DescribeTaskDefinition',
                            'ecs:DescribeTasks',
                            'ecs:ListTasks',
                            'ecs:RegisterTaskDefinition',
                            'ecs:UpdateService',
                        ],
                        resources: ['*'],
                    },
                ],
                provider: this.config.provider,
            }).json,
        })
        return codepipelineRole
    }

    private createEcrEventRule(): CloudwatchEventRule {
        const defaultEventBus = new DataAwsCloudwatchEventBus(this, 'default_event_bus', {
            name: 'default',
            provider: this.config.provider,
        })

        new CloudwatchEventBusPolicy(this, 'ecr_event_bus_role_policy', {
            eventBusName: defaultEventBus.name,
            policy: new DataAwsIamPolicyDocument(this, 'ecr_event_bus_role_policy_document', {
                statement: [
                    {
                        effect: 'Allow',
                        actions: ['events:PutEvents'],
                        principals: [
                            {
                                identifiers: [
                                    `arn:aws:iam::${ThalloAccountRegistry.infrastructure.sharedServices}:root`,
                                ],
                                type: 'AWS',
                            },
                        ],
                        resources: [defaultEventBus.arn],
                        sid: 'AllowEcrEventBusToPutEvents',
                    },
                ],
                provider: this.config.provider,
            }).json,
        })

        const eventBridgeInvokeCodePipelineRole = new IamRole(
            this,
            'event_bridge_invoke_code_pipeline_role',
            {
                name: `${this.config.pipelineName}-event_bridge_invoke_code_pipeline_role`,
                assumeRolePolicy: new DataAwsIamPolicyDocument(
                    this,
                    'event_bridge_invoke_code_pipeline_role_assume_role_policy',
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
                        provider: this.config.provider,
                    },
                ).json,
            },
        )

        new IamRolePolicy(this, 'event_bridge_invoke_code_pipeline_role_policy', {
            name: `${this.config.pipelineName}-event_bridge_invoke_code_pipeline_role_policy`,
            role: eventBridgeInvokeCodePipelineRole.id,
            policy: new DataAwsIamPolicyDocument(
                this,
                'event_bridge_invoke_code_pipeline_role_policy_document',
                {
                    statement: [
                        {
                            effect: 'Allow',
                            actions: ['codepipeline:StartPipelineExecution'],
                            resources: [this.codePipeline.arn],
                        },
                    ],
                    provider: this.config.provider,
                },
            ).json,
        })

        return new ApplicationEventBridgeRule(this, 'ecr_event_rule', {
            name: `${this.config.pipelineName}-ecr_codepipeline_event_rule`,
            description: 'Trigger Codepipeline when new image is pushed to ECR',
            roleArn: eventBridgeInvokeCodePipelineRole.arn,
            eventPattern: {
                // detailType: ['AWS API Call via CloudTrail'],
                detail: {
                    eventSource: ['ecr.amazonaws.com'],
                    eventName: ['PutImage'],
                    requestParameters: {
                        repositoryName: [this.config.source.imageRepositoryName],
                        imageTag: [this.config.source.imageTag],
                    },
                },
                source: ['aws.ecr'],
            },
            targets: [
                {
                    targetId: 'codepipeline',
                    arn: this.codePipeline.arn,
                },
            ],
        }).rule
    }

    // S3 event trigger

    private createS3EventRule(pipeline: Codepipeline): CloudwatchEventRule {
        // const eventBridgeInvokeCodePipelineRole = new IamRole(
        //     this,
        //     `s3-eventbridge_codepipeline_role`,
        //     {
        //         name: `${pipeline.name}-s3-eventbridge_codepipeline_role`,
        //         assumeRolePolicy: new DataAwsIamPolicyDocument(
        //             this,
        //             `s3-eventbridge_invoke_code_pipeline_role_assume_role_policy`,
        //             {
        //                 statement: [
        //                     {
        //                         effect: 'Allow',
        //                         actions: ['sts:AssumeRole'],
        //                         principals: [
        //                             {
        //                                 identifiers: ['events.amazonaws.com'],
        //                                 type: 'Service',
        //                             },
        //                         ],
        //                     },
        //                 ],
        //             },
        //         ).json,
        //     },
        // )

        // new IamRolePolicy(this, `s3-event_bridge_invoke_code_pipeline_role_policy`, {
        //     name: `${pipeline.name}-s3-event_bridge_invoke_code_pipeline_role_policy`,
        //     role: eventBridgeInvokeCodePipelineRole.id,
        //     policy: new DataAwsIamPolicyDocument(
        //         this,
        //         `s3-eventbridge_invoke_code_pipeline_role_policy_document`,
        //         {
        //             statement: [
        //                 {
        //                     effect: 'Allow',
        //                     actions: ['codepipeline:StartPipelineExecution'],
        //                     resources: [pipeline.arn],
        //                 },
        //                 {
        //                     effect: 'Allow',
        //                     actions: ['sns:Publish'],
        //                     resources: ['*'],
        //                 },
        //             ],
        //         },
        //     ).json,
        // })

        return new ApplicationEventBridgeRule(this, `s3_event_rule`, {
            name: `${pipeline.name}-s3_codepipeline_event_rule`,
            description: 'S3.PutObject for CodePipeline source file',
            // roleArn: eventBridgeInvokeCodePipelineRole.arn,
            eventPattern: {
                // detailType: ['AWS API Call via CloudTrail'],
                detail: {
                    eventSource: ['s3.amazonaws.com'],
                    eventName: ['PutObject'],
                    requestParameters: {
                        bucketName: [this.config.source.sourceBucket.id],
                        key: [`taskdef.zip`],
                    },
                },
                source: ['aws.s3'],
            },
            targets: [
                // {
                //     targetId: 'codepipeline',
                //     arn: pipeline.arn,
                // },
                {
                    targetId: 'sns',
                    arn: this.config.snsNotificationTopicArn || '',
                },
            ],
        }).rule
    }

    /**
     * CodeBuild projects
     */

    private getDbMigrationCodebuildProject = (): ThalloCodeBuildProject => {
        return new ThalloCodeBuildProject(this, 'db_migration_codebuild_project', {
            name: `${this.config.pipelineName}-db-migration`,
            buildSpecFilePath: `arn:aws:s3:::codebuild.${this.config.serviceName}.${this.config.environment}-${this.caller.accountId}/buildspec_db_migration.yml`, //TODO: change to parameter
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
    private getSourceStage(): CodepipelineStage {
        const actions = []
        actions.push(this.getSourceS3CheckoutAction())
        // actions.push(this.getSourceECRAction())
        return {
            name: 'Source',
            action: actions,
        }
    }

    private getSourceS3CheckoutAction = (): CodepipelineStageAction => ({
        name: 'S3_checkout',
        version: '1',
        category: 'Source',
        owner: 'AWS',
        provider: 'S3',
        outputArtifacts: ['SourceS3ArtifactOutput'],
        configuration: {
            S3Bucket: this.config.source.sourceBucket.id,
            S3ObjectKey: `taskdef.zip`,
            PollForSourceChanges: 'true',
        },
        runOrder: 1,
    })

    /**
     * Deploy Stage
     */
    private getDeployStage(): CodepipelineStage {
        const actions = [this.getDeployDbMigrationAction(), this.getDeployEcsMainAction()]

        if (this.config.useAsyncProcessing) {
            actions.push(this.getDeployEcsAsyncAction())
        }

        return {
            name: 'Deploy',
            action: actions,
        }
    }

    private getDeployDbMigrationAction(): CodepipelineStageAction {
        return {
            name: 'Run_DB_Migration',
            category: 'Build',
            owner: 'AWS',
            provider: 'CodeBuild',
            inputArtifacts: ['SourceS3ArtifactOutput'],
            outputArtifacts: [],
            version: '1',
            configuration: {
                ProjectName: this.dbMigrationCodebuildProjectName,
            },
            runOrder: 1,
        }
    }

    private getDeployEcsAsyncAction = (): CodepipelineStageAction => ({
        name: 'Deploy_ECS_async',
        category: 'Deploy',
        owner: 'AWS',
        provider: 'ECS',
        inputArtifacts: ['SourceS3ArtifactOutput'],
        outputArtifacts: [],
        version: '1',
        configuration: {
            ClusterName: `${this.config.serviceName}-async-processor`,
            ServiceName: `${this.config.serviceName}-async-processor`,
            FileName: `imagedef_${this.config.serviceName}-async-processor.json`,
            DeploymentTimeout: '15',
        },
        runOrder: 2,
    })

    private getDeployEcsMainAction = (): CodepipelineStageAction => ({
        name: 'Deploy_ECS_main',
        category: 'Deploy',
        owner: 'AWS',
        provider: 'CodeDeployToECS',
        inputArtifacts: ['SourceS3ArtifactOutput'],
        outputArtifacts: [],
        version: '1',
        configuration: {
            ApplicationName: this.codeDeployApplicationName,
            DeploymentGroupName: this.codeDeployDeploymentGroupName,
            TaskDefinitionTemplateArtifact: 'SourceS3ArtifactOutput',
            TaskDefinitionTemplatePath: `taskdef_${this.config.serviceName}.json`,
            AppSpecTemplateArtifact: 'SourceS3ArtifactOutput',
            AppSpecTemplatePath: `appspec_${this.config.serviceName}.json`,
        },
        runOrder: 2,
    })
}
