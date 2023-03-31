import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document'
import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { SnsTopic } from '@cdktf/provider-aws/lib/sns-topic'
import { S3Backend, TerraformStack } from 'cdktf'
import { Construct } from 'constructs'
import { ThalloAccountRegistry } from '../../../../../constructs/thallo/ThalloAccountRegistry'
import { config } from '../../SharedConfig'

export class SharedSnsStack extends TerraformStack {
    private snsPolicy: DataAwsIamPolicyDocument
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
            key: `tf-state/shared-${ThalloAccountRegistry.infrastructure.sharedServices}-sns.json`,
            region: config.aws.region,
        })

        this.snsPolicy = this.createSnsIamPolicy()

        // Topics
        this.createBackendChatbotSnsTopic()
        this.createCriticalAlarmsSnsTopic()
        this.createCriticalAlarmsSnsTopicUsEast1()
        this.createNotificationsSnsTopic()
        this.createSesSnsTopic()
    }

    private createBackendChatbotSnsTopic(): SnsTopic {
        return new SnsTopic(this, 'sns_topic_chatbot', {
            name: `ci-cd-notifications-chatbot`,
            displayName: `ci-cd-notifications-chatbot`,
            policy: this.snsPolicy.json,
        })
    }

    private createCriticalAlarmsSnsTopic(): SnsTopic {
        return new SnsTopic(this, 'critical_alarms_sns', {
            name: `critical-alarms-chatbot`,
            displayName: `critical-alarms-chatbot`,
            policy: this.snsPolicy.json,
        })
    }

    private createCriticalAlarmsSnsTopicUsEast1(): SnsTopic {
        const provider = new AwsProvider(this, 'aws_us_east_1', {
            region: 'us-east-1',
            alias: 'us-east-1',
            assumeRole: [
                {
                    roleArn: `arn:aws:iam::${ThalloAccountRegistry.infrastructure.sharedServices}:role/terraform-build-role`,
                },
            ],
            profile: config.aws.local.profile,
        })

        return new SnsTopic(this, 'critical_alarms_sns_us_east_1', {
            provider,
            name: `critical-alarms-chatbot`,
            displayName: `critical-alarms-chatbot`,
            policy: this.snsPolicy.json,
        })
    }

    private createNotificationsSnsTopic(): SnsTopic {
        return new SnsTopic(this, 'non_critical_alarms_sns', {
            name: `notifications-chatbot`,
            displayName: `notifications-chatbot`,
            policy: this.snsPolicy.json,
        })
    }

    private createSesSnsTopic(): SnsTopic {
        const snsPolicy = new DataAwsIamPolicyDocument(this, 'ses_sns_topic_policy', {
            statement: [
                {
                    effect: 'Allow',
                    actions: ['sns:Publish'],
                    principals: [
                        {
                            identifiers: ['ses.amazonaws.com'],
                            type: 'Service',
                        },
                    ],
                    resources: [
                        `arn:aws:sns:eu-west-1:${ThalloAccountRegistry.infrastructure.sharedServices}:*`,
                    ],
                    condition: [
                        {
                            test: 'StringEquals',
                            variable: 'AWS:SourceAccount',
                            values: [`${ThalloAccountRegistry.infrastructure.sharedServices}`],
                        },
                        {
                            test: 'StringLike',
                            variable: 'AWS:SourceArn',
                            values: ['arn:aws:ses:*'],
                        },
                    ],
                },
            ],
        })

        return new SnsTopic(this, 'ses_notifications_sns', {
            name: `ses-notifications-chatbot`,
            displayName: `ses-notifications-chatbot`,
            policy: snsPolicy.json,
        })
    }

    private createSnsIamPolicy(): DataAwsIamPolicyDocument {
        return new DataAwsIamPolicyDocument(this, 'sns_topic_policy', {
            statement: [
                {
                    effect: 'Allow',
                    actions: ['sns:Publish'],
                    principals: [
                        {
                            identifiers: [
                                'chatbot.amazonaws.com',
                                'codestar-notifications.amazonaws.com',
                                'cloudwatch.amazonaws.com',
                                'codepipeline.amazonaws.com',
                                'events.amazonaws.com',
                                's3.amazonaws.com',
                            ],
                            type: 'Service',
                        },
                    ],
                    resources: ['*'],
                },
            ],
        })
    }
}
