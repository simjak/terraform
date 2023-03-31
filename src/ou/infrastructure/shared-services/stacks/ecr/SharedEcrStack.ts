import { EcrRepositoryPolicy } from '@cdktf/provider-aws/lib/ecr-repository-policy'
import { ThalloService } from './../../../../../constructs/thallo/ThalloApplicationConfig'
import { EcrRepository } from '@cdktf/provider-aws/lib/ecr-repository'
import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { S3Backend, TerraformStack } from 'cdktf'
import { Construct } from 'constructs/lib'
import { ApplicationECR } from '../../../../../constructs/base/ApplicationECR'
import { config } from '../../SharedConfig'
import { ThalloAccountRegistry } from '../../../../../constructs/thallo/ThalloAccountRegistry'
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document'
import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule'
import { IamRole } from '@cdktf/provider-aws/lib/iam-role'
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy'
import {
    ApplicationEventBridgeRule,
    Target,
} from '../../../../../constructs/base/ApplicationEventBridgeRule'

export class SharedEcrStack extends TerraformStack {
    constructor(scope: Construct, id: string) {
        super(scope, id)

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
            key: `tf-state/shared-${ThalloAccountRegistry.infrastructure.sharedServices}-ecr.json`,
            region: config.aws.region,
        })

        //TODO: think how to implement in more generic way ECR permissions per account
        this.createEcrRepository(ThalloService.EXCHANGE_BE)
        this.createEcrRepository(ThalloService.EXCHANGE_FE)

        this.createEcrRepository(ThalloService.BRIDGE_BE)

        // Tooling
        this.createEcrRepository('cdktf-codebuild')

        /**
         * EventBridge rules
         */

        const remoteAccounts = [
            ThalloAccountRegistry.workloads.staging.exchange,
            ThalloAccountRegistry.workloads.demo.exchange,
        ]
        this.createEcrEventRule(remoteAccounts)
    }

    private createEcrRepository(serviceName: string): EcrRepository {
        const ecr = new ApplicationECR(this, `${serviceName}_ecr}`, {
            name: serviceName,
            tags: {
                service: serviceName,
                environment: config.environment,
            },
        }).ecr

        new EcrRepositoryPolicy(this, `${serviceName}_ecr_policy`, {
            repository: ecr.name,
            policy: new DataAwsIamPolicyDocument(this, `${serviceName}_ecr_policy_document`, {
                statement: [
                    {
                        effect: 'Allow',
                        actions: [
                            'ecr:GetDownloadUrlForLayer',
                            'ecr:BatchGetImage',
                            'ecr:BatchCheckLayerAvailability',
                            'ecr:PutImage',
                            'ecr:InitiateLayerUpload',
                            'ecr:UploadLayerPart',
                            'ecr:CompleteLayerUpload',
                            'ecr:PullImage',
                            'ecr:DescribeRepositories',
                            'ecr:CreateRepository',
                            'ecs:UpdateService',
                        ],
                        principals: [
                            {
                                identifiers: [
                                    `arn:aws:iam::${ThalloAccountRegistry.workloads.staging.exchange}:root`,
                                    `arn:aws:iam::${ThalloAccountRegistry.workloads.staging.exchange}:role/exchange-be-ecs-codedeploy-role`,
                                    `arn:aws:iam::${ThalloAccountRegistry.workloads.demo.exchange}:root`,
                                    `arn:aws:iam::${ThalloAccountRegistry.workloads.demo.exchange}:role/exchange-be-ecs-codedeploy-role`,
                                ],
                                type: 'AWS',
                            },
                        ],
                    },
                ],
            }).json,
        })

        return ecr
    }

    // ECR Cross-account events

    private createEcrEventRule(remoteAccounts: string[]): CloudwatchEventRule {
        const eventBridgeEcrEventsRole = new IamRole(this, 'ecr_event_bridge_assume_role', {
            name: `ecr-event-bridge-role-cross-account-role`,
            assumeRolePolicy: new DataAwsIamPolicyDocument(
                this,
                'data_ecr_event_bridge_assume_role_policy_document',
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
        })

        const eventResources: string[] = [
            `arn:aws:sns:${config.aws.region}:${ThalloAccountRegistry.infrastructure.sharedServices}:notifications-chatbot`,
        ]

        remoteAccounts.forEach((account) => {
            eventResources.push(`arn:aws:events:${config.aws.region}:${account}:event-bus/default`)
        })

        new IamRolePolicy(this, 'ecr_event_bridge_assume_role_policy', {
            name: `ecr-event-bridge-role-cross-account-role-policy`,
            role: eventBridgeEcrEventsRole.id,
            policy: new DataAwsIamPolicyDocument(
                this,
                'ecr_event_bridge_assume_role_policy_document',
                {
                    statement: [
                        {
                            effect: 'Allow',
                            actions: ['events:PutEvents'],
                            resources: eventResources,
                        },
                    ],
                },
            ).json,
        })

        const remoteTargets: Target[] = []
        remoteAccounts.forEach((account) => {
            remoteTargets.push({
                targetId: `remote-account-event-bus-${account}`,
                arn: `arn:aws:events:${config.aws.region}:${account}:event-bus/default`,
            })
        })

        return new ApplicationEventBridgeRule(this, 'ecr_event_rule', {
            name: `ecr-cross-account-events`,
            description: 'Pushes ECR cross account events',
            roleArn: eventBridgeEcrEventsRole.arn,
            eventPattern: {
                source: ['aws.ecr'],
                // detailType: ['AWS API Call via CloudTrail'],
                detail: {
                    eventSource: ['ecr.amazonaws.com'],
                    eventName: ['PutImage'],
                },
            },
            targets: remoteTargets,
        }).rule
    }
}
