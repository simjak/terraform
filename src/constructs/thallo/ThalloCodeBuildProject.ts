import {
    CodebuildProject,
    CodebuildProjectEnvironmentEnvironmentVariable,
    CodebuildProjectSource,
} from '@cdktf/provider-aws/lib/codebuild-project'
import { CodestarnotificationsNotificationRule } from '@cdktf/provider-aws/lib/codestarnotifications-notification-rule'
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity'
import {
    DataAwsIamPolicyDocument,
    DataAwsIamPolicyDocumentStatement,
} from '@cdktf/provider-aws/lib/data-aws-iam-policy-document'
import { DataAwsRegion } from '@cdktf/provider-aws/lib/data-aws-region'
import { IamRole } from '@cdktf/provider-aws/lib/iam-role'
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy'
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment'
import { TerraformMetaArguments } from 'cdktf'
import { Construct } from 'constructs/lib'
import { ThalloAccountRegistry } from './ThalloAccountRegistry'

export interface ThalloCodeBuildProjectProps extends TerraformMetaArguments {
    name: string
    description?: string
    buildSpecFilePath: string
    source?: CodebuildProjectSource
    environment?: {
        imagePullCredentialsType?: 'CODEBUILD' | 'SERVICE_ROLE'
        computeType?: string
        environmentVariables?: CodebuildProjectEnvironmentEnvironmentVariable[]
        image?: string
        privilegedMode?: boolean
    }
    codeStarConnectionArn?: string
    snsNotificationTopicArn?: string
    codeBuildRolePolicyStatements?: DataAwsIamPolicyDocumentStatement[]
    tags?: { [key: string]: string }
}

export class ThalloCodeBuildProject extends Construct {
    private readonly config: ThalloCodeBuildProjectProps
    private readonly region: DataAwsRegion
    private readonly caller: DataAwsCallerIdentity
    public readonly codeBuildProject: CodebuildProject

    constructor(scope: Construct, name: string, config: ThalloCodeBuildProjectProps) {
        super(scope, name)
        this.config = config
        this.region = new DataAwsRegion(this, 'region', {})
        this.caller = new DataAwsCallerIdentity(this, 'caller')

        this.codeBuildProject = this.setupCodeBuildProject()
    }

    private setupCodeBuildProject(): CodebuildProject {
        const codeBuildServiceRole = this.createCodeBuildRole()

        const codeBuildProject = new CodebuildProject(this, `ecs_codebuild_project`, {
            name: this.config.name,
            description: this.config.description,
            serviceRole: codeBuildServiceRole.arn,
            source: this.config.source ?? {
                buildspec: this.config.buildSpecFilePath,
                type: 'CODEPIPELINE',
            },
            artifacts: {
                type: 'CODEPIPELINE',
            },
            environment: {
                imagePullCredentialsType:
                    this.config.environment?.imagePullCredentialsType ?? 'CODEBUILD',
                computeType: this.config.environment?.computeType ?? 'BUILD_GENERAL1_SMALL',
                image: this.config.environment?.image ?? 'aws/codebuild/standard:6.0',
                type: 'LINUX_CONTAINER',
                privilegedMode: this.config.environment?.privilegedMode || false,
                environmentVariable: this.config.environment?.environmentVariables ?? [],
            },
            buildTimeout: 60,
            tags: this.config.tags,
        })

        if (this.config.snsNotificationTopicArn) {
            new CodestarnotificationsNotificationRule(this, 'notification_rule', {
                name: `${this.config.name}-${this.caller.accountId}-codebuild`,
                detailType: 'BASIC',
                resource: codeBuildProject.arn,
                eventTypeIds: [
                    'codebuild-project-build-state-failed',
                    'codebuild-project-build-state-stopped',
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

        return codeBuildProject
    }

    private createCodeBuildRole(): IamRole {
        const role = new IamRole(this, `codebuild_role`, {
            name: `${this.config.name}_codebuild_role`,
            assumeRolePolicy: new DataAwsIamPolicyDocument(
                this,
                `${this.config.name}_codebuild_assume_role_policy`,
                {
                    statement: [
                        {
                            actions: ['sts:AssumeRole'],
                            effect: 'Allow',
                            principals: [
                                {
                                    identifiers: ['codebuild.amazonaws.com'],
                                    type: 'Service',
                                },
                            ],
                        },
                    ],
                },
            ).json,
            tags: this.config.tags,
            provider: this.config.provider,
        })

        new IamRolePolicyAttachment(this, `codebuild_role_policy_attachment_codebuild_admin`, {
            role: role.name,
            policyArn: 'arn:aws:iam::aws:policy/AWSCodeBuildAdminAccess',
            provider: this.config.provider,
        })

        new IamRolePolicyAttachment(this, `codebuild_role_policy_attachment_sysadmin_admin`, {
            role: role.name,
            policyArn: 'arn:aws:iam::aws:policy/job-function/SystemAdministrator',
            provider: this.config.provider,
        })

        const policyStatement: DataAwsIamPolicyDocumentStatement[] = [
            {
                effect: 'Allow',
                actions: ['iam:PassRole', 'iam:ListInstanceProfiles'],
                resources: [
                    `arn:aws:iam::${this.caller.accountId}:role/exchange*`,
                    `arn:aws:iam::${this.caller.accountId}:role/bridge*`,
                ],
            },
            {
                effect: 'Allow',
                actions: [
                    'secretsmanager:GetSecretValue',
                    'secretsmanager:GetResourcePolicy',
                    'secretsmanager:DescribeSecret',
                ],
                resources: [
                    `arn:aws:secretsmanager:${this.region.name}:${this.caller.accountId}:secret:*`,
                ],
            },
            {
                effect: 'Allow',
                actions: [
                    'wafv2:GetWebACL',
                    'wafv2:ListTagsForResource',
                    `wafv2:GetWebACLForResource`,
                ],
                resources: [
                    `arn:aws:wafv2:${this.region.name}:${this.caller.accountId}:regional/webacl/*`,
                ],
            },
            {
                effect: 'Allow',
                actions: ['logs:CreateLogStream', 'logs:CreateLogGroup', 'logs:PutLogEvents'],
                resources: ['*'],
            },
            {
                effect: 'Allow',
                actions: [
                    's3:GetObject',
                    's3:GetObjectVersion',
                    's3:PutObject',
                    's3:GetBucketAcl',
                    's3:GetBucketLocation',
                ],
                resources: ['arn:aws:s3:::*'],
            },
            {
                effect: 'Allow',
                actions: ['ecr:*'],
                resources: [
                    `arn:aws:ecr:eu-west-1:${ThalloAccountRegistry.infrastructure.sharedServices}:repository/cdktf-codebuild`,
                    `arn:aws:ecr:eu-west-1:${ThalloAccountRegistry.infrastructure.sharedServices}:repository//bridge-be`,
                    `arn:aws:ecr:eu-west-1:${ThalloAccountRegistry.infrastructure.sharedServices}:repository/exchange-be`,
                ],
            },
            {
                effect: 'Allow',
                actions: ['ecr:GetAuthorizationToken'],
                resources: [`*`],
            },
            {
                effect: 'Allow',
                actions: [
                    'ecs:DescribeClusters',
                    'ecs:DescribeTaskDefinition',
                    'ecs:DescribeServices',
                    'ecs:DescribeTasks',
                    'ecs:CreateTaskSet',
                    'ecs:RunTask',
                    'ecs:UpdateServicePrimaryTaskSet',
                ],
                resources: ['*'],
            },
            {
                effect: 'Allow',
                actions: [
                    'application-autoscaling:DescribeScalableTargets',
                    'application-autoscaling:DescribeScalingPolicies',
                ],
                resources: ['*'],
            },
            {
                effect: 'Allow',
                actions: [
                    'codestar-connections:UseConnection',
                    'codestar-notifications:DescribeNotificationRule',
                    'codestar-connections:ListConnections',
                ],
                resources: ['*'],
            },
            {
                effect: 'Allow',
                actions: ['sts:GetServiceBearerToken'],
                resources: ['*'],
                condition: [
                    {
                        test: 'StringEquals',
                        variable: 'sts:AWSServiceName',
                        values: ['codeartifact.amazonaws.com'],
                    },
                ],
            },
            {
                effect: 'Allow',
                actions: ['sts:AssumeRole'],
                resources: [
                    `arn:aws:iam::${ThalloAccountRegistry.infrastructure.sharedServices}:role/terraform-build-role`,
                ],
            },
            {
                effect: 'Allow',
                actions: ['cloudfront:*'],
                resources: ['*'],
            },
        ]

        if (this.config.codeBuildRolePolicyStatements) {
            policyStatement.push(...this.config.codeBuildRolePolicyStatements)
        }

        new IamRolePolicy(this, 'codebuild_role_policy', {
            name: `${this.config.name}_codebuild_service_role_policy`,
            role: role.id,
            policy: new DataAwsIamPolicyDocument(
                this,
                `${this.config.name}_codebuild_role_policy_document`,
                {
                    statement: policyStatement,
                    provider: this.config.provider,
                },
            ).json,
        })
        return role
    }
}
