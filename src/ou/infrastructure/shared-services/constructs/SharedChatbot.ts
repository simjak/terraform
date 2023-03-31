import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document'
import { IamRole } from '@cdktf/provider-aws/lib/iam-role'
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy'
import { Construct } from 'constructs'
import { ChatbotSlackChannelConfiguration } from '../.gen/providers/awscc/chatbot-slack-channel-configuration'

export interface SharedChatbotProps {
    configurationName: string
    slackWorkspaceId: string
    slackChannelId: string
    snsTopicArns?: string[]
}

export class SharedChatbotSlack extends Construct {
    private props: SharedChatbotProps
    constructor(scope: Construct, id: string, props: SharedChatbotProps) {
        super(scope, id)
        this.props = props

        this.createChatbotSlackChannelConfiguration()
    }

    private createChatbotSlackChannelConfiguration(): ChatbotSlackChannelConfiguration {
        const chatbotSlackIamRole = new IamRole(this, 'chatbot_slack_iam_role', {
            name: `${this.props.configurationName}-role`,
            assumeRolePolicy: new DataAwsIamPolicyDocument(
                this,
                'chatbot_slack_iam_assume_role_policy',
                {
                    statement: [
                        {
                            actions: ['sts:AssumeRole'],
                            effect: 'Allow',
                            principals: [
                                {
                                    identifiers: ['chatbot.amazonaws.com'],
                                    type: 'Service',
                                },
                            ],
                        },
                    ],
                },
            ).json,
        })

        new IamRolePolicy(this, 'chatbot_critical_alarms_iam_policy', {
            name: `${this.props.configurationName}-policy`,
            role: chatbotSlackIamRole.name,
            policy: new DataAwsIamPolicyDocument(this, 'chatbot_slack_iam_role_policy', {
                statement: [
                    {
                        actions: [
                            'autoscaling:Describe*',
                            'cloudwatch:Describe*',
                            'cloudwatch:Get*',
                            'cloudwatch:List*',
                            'logs:Get*',
                            'logs:List*',
                            'logs:Describe*',
                            'logs:TestMetricFilter',
                            'logs:FilterLogEvents',
                            'logs:StartQuery',
                            'logs:StopQuery',
                            'logs:GetQueryResults',
                            'sns:Get*',
                            'sns:List*',
                        ],
                        effect: 'Allow',
                        resources: ['*'],
                    },
                ],
            }).json,
        })

        return new ChatbotSlackChannelConfiguration(this, 'chatbot_slack_channel_configuration', {
            iamRoleArn: chatbotSlackIamRole.arn,
            configurationName: this.props.configurationName,
            slackWorkspaceId: this.props.slackWorkspaceId,
            slackChannelId: this.props.slackChannelId,
            snsTopicArns: this.props.snsTopicArns,
        })
    }
}
