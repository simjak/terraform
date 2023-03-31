import {
    CodepipelineStage,
    Codepipeline,
    CodepipelineArtifactStore,
} from '@cdktf/provider-aws/lib/codepipeline'
import {
    DataAwsIamPolicyDocument,
    DataAwsIamPolicyDocumentStatement,
} from '@cdktf/provider-aws/lib/data-aws-iam-policy-document'
import { IamRole } from '@cdktf/provider-aws/lib/iam-role'
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket'
import { S3BucketPublicAccessBlock } from '@cdktf/provider-aws/lib/s3-bucket-public-access-block'
import { TerraformMetaArguments } from 'cdktf'
import { Construct } from 'constructs/lib'
import { createHash } from 'crypto'
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy'
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity'
import { CodestarnotificationsNotificationRule } from '@cdktf/provider-aws/lib/codestarnotifications-notification-rule'

export interface ThalloInfraCodePipelineProps extends TerraformMetaArguments {
    name: string
    codepipelineRolePolicyStatements?: DataAwsIamPolicyDocumentStatement[]
    preDeployStages?: CodepipelineStage[]
    sourceStage?: CodepipelineStage
    deployStage?: CodepipelineStage
    postDeployStages?: CodepipelineStage[]
    snsNotificationTopicArn?: string
    tags?: { [key: string]: string }
}

export class ThalloInfraCodePipeline extends Construct {
    public readonly codePipeline: Codepipeline
    public readonly stages: CodepipelineStage[]
    public readonly pipelineName: string
    private readonly pipelineArtifactBucket: S3Bucket
    private readonly pipelineRole: IamRole
    private readonly caller: DataAwsCallerIdentity

    constructor(scope: Construct, id: string, private config: ThalloInfraCodePipelineProps) {
        super(scope, id)

        this.caller = new DataAwsCallerIdentity(this, 'caller_identity', {})

        this.pipelineName = this.getPipelineName()

        this.stages = this.getStages()

        this.pipelineArtifactBucket = this.createArtifactBucket()
        this.pipelineRole = this.createPipelineRole()
        this.codePipeline = this.createCodePipeline()
    }

    // Pipeline name should uniquely identify the pipeline eg. infra-shared-terraform, infra-staging-bridge, app-staging-bridge, app-prod-bridge, etc.
    // <ou>-<env>-<app_name>
    private getPipelineName = (): string => `${this.config.name}`

    /*
     * Get all stages for the pipeline, including postDeployStage if provided
     */
    private getStages = () => [
        ...(this.config.sourceStage ? [this.config.sourceStage] : []),
        ...(this.config.deployStage ? [this.config.deployStage] : []),
        ...(this.config.preDeployStages ? this.config.preDeployStages : []),
        ...(this.config.postDeployStages ? this.config.postDeployStages : []),
    ]

    private createArtifactBucket(): S3Bucket {
        const prefixHash = createHash('md5').update(this.config.name).digest('hex')
        const truncatedHash = prefixHash.substring(0, 10)

        const artifactBucket = new S3Bucket(this, 'artifact_bucket', {
            bucket: `${this.getPipelineName()}-${truncatedHash}`,
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
        const role = new IamRole(this, 'codepipeline_role', {
            name: `${this.config.name}-codepipeline_role`,
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

        const policyStatement: DataAwsIamPolicyDocumentStatement[] = [
            {
                effect: 'Allow',
                actions: [
                    'codebuild:BatchGetBuilds',
                    'codebuild:StartBuild',
                    'codebuild:BatchGetBuildBatches',
                    'codebuild:StartBuildBatch',
                ],
                resources: ['arn:aws:codebuild:*'],
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
                ],
            },
        ]

        if (this.config.codepipelineRolePolicyStatements) {
            policyStatement.push(...this.config.codepipelineRolePolicyStatements)
        }

        new IamRolePolicy(this, 'codepipeline_role_policy', {
            name: `${this.config.name}-codepipeline-role-policy`,
            role: role.id,
            policy: new DataAwsIamPolicyDocument(this, 'codepipeline_role_policy_document', {
                statement: policyStatement,
                provider: this.config.provider,
            }).json,
        })

        return role
    }
}
