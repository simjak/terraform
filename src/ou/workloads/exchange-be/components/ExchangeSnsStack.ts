import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document'
import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { SnsTopic } from '@cdktf/provider-aws/lib/sns-topic'
import { S3Backend, TerraformStack } from 'cdktf'
import { Construct } from 'constructs'
import {
    createApplicationConfig,
    ThalloApplicationConfig,
} from '../../../../constructs/thallo/ThalloApplicationConfig'
import { exchangeConfigInput } from '../ExchangeConfig'

export class ExchangeSnsStack extends TerraformStack {
    private snsPolicy: DataAwsIamPolicyDocument
    private config: ThalloApplicationConfig
    constructor(scope: Construct, name: string) {
        super(scope, name)

        this.config = createApplicationConfig(exchangeConfigInput)

        new AwsProvider(this, 'aws', {
            profile: this.config.aws.profile,
            region: this.config.aws.region,
            assumeRole: [
                {
                    roleArn: `arn:aws:iam::${this.config.aws.account.target}:role/terraform-build-role`,
                },
            ],
        })

        new S3Backend(this, {
            // Terraform state buckets are in the shared services account
            roleArn: `arn:aws:iam::${this.config.aws.account.sharedServices}:role/terraform-build-role`,
            bucket: `tf-state.${this.config.serviceName}.${this.config.environment}-${this.config.aws.account.target}`,
            key: `tf-state/${this.config.serviceName}-${this.config.aws.account.target}-sns.json`,
            region: this.config.aws.region,
        })

        this.snsPolicy = this.createSnsIamPolicy()

        // SNS Topics
        this.createBackendChatbotSnsTopic()
        this.createCriticalAlarmsSnsTopic()
        this.createCriticalAlarmsSnsTopicUsEast1()
        this.createNonCriticalAlarmsSnsTopic()
    }

    // SNS Topics
    private createBackendChatbotSnsTopic(): SnsTopic {
        return new SnsTopic(this, 'sns_topic_chatbot', {
            name: `Backend-${this.config.environment}-ChatBot`,
            displayName: `Backend-${this.config.environment}-ChatBot`,
            policy: this.snsPolicy.json,
        })
    }

    private createCriticalAlarmsSnsTopic(): SnsTopic {
        return new SnsTopic(this, 'critical_alarms_sns', {
            name: `CriticalAlarms-${this.config.environment}-ChatBot`,
            displayName: `CriticalAlarms-${this.config.environment}-ChatBot`,
            policy: this.snsPolicy.json,
        })
    }

    private createCriticalAlarmsSnsTopicUsEast1(): SnsTopic {
        const provider = new AwsProvider(this, 'aws_us_east_1', {
            region: 'us-east-1',
            alias: 'us-east-1',
            assumeRole: [
                {
                    roleArn: `arn:aws:iam::${this.config.aws.account.target}:role/terraform-build-role`,
                },
            ],
            profile: this.config.aws.profile,
        })

        return new SnsTopic(this, 'critical_alarms_sns_us_east_1', {
            provider,
            name: `CriticalAlarms-${this.config.environment}-ChatBot`,
            displayName: `CriticalAlarms-${this.config.environment}-ChatBot`,
            policy: this.snsPolicy.json,
        })
    }

    private createNonCriticalAlarmsSnsTopic(): SnsTopic {
        return new SnsTopic(this, 'non_critical_alarms_sns', {
            name: `NonCriticalAlarms-${this.config.environment}-ChatBot`,
            displayName: `NonCriticalAlarms-${this.config.environment}-ChatBot`,
            policy: this.snsPolicy.json,
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
