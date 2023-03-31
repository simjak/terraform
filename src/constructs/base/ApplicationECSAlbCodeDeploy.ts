import { CodedeployApp } from '@cdktf/provider-aws/lib/codedeploy-app'
import { CodedeployDeploymentGroup } from '@cdktf/provider-aws/lib/codedeploy-deployment-group'
import { CodestarnotificationsNotificationRule } from '@cdktf/provider-aws/lib/codestarnotifications-notification-rule'
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity'
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document'
import { DataAwsRegion } from '@cdktf/provider-aws/lib/data-aws-region'
import { IamRole } from '@cdktf/provider-aws/lib/iam-role'
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment'
import { TerraformMetaArguments, TerraformResource } from 'cdktf'
import { Construct } from 'constructs/lib'

export interface ApplicationECSAlbCodeDeployProps extends TerraformMetaArguments {
    serviceName: string
    clusterName: string
    listenerArn: string
    snsNotificationTopicArn?: string
    targetGroupNames: string[]
    tags?: { [key: string]: string }
    dependsOn?: TerraformResource[]
    notifications?: {
        notifyOnStarted?: boolean
        notifyOnSucceeded?: boolean
        notifyOnFailed?: boolean
    }
    blueGreenDeploymentConfig?: {
        terminationWaitTimeInMinutes?: number
    }
}

interface CodeDeployResponse {
    codeDeployApp: CodedeployApp
    ecsCodeDeployRole: IamRole
}

/**
 * Represents a ecs Codedeploy App that uses an ALB
 */

export class ApplicationECSAlbCodeDeploy extends Construct {
    private readonly config: ApplicationECSAlbCodeDeployProps

    public readonly codeDeployApp: CodedeployApp
    public readonly codeDeployDeploymentGroup: CodedeployDeploymentGroup
    private callerIdentity: DataAwsCallerIdentity

    constructor(scope: Construct, name: string, config: ApplicationECSAlbCodeDeployProps) {
        super(scope, name)

        this.config = config

        this.callerIdentity = new DataAwsCallerIdentity(this, 'caller_identity')

        const { codeDeployApp, ecsCodeDeployRole } = this.setupCodeDeployApp()
        this.codeDeployApp = codeDeployApp

        this.codeDeployDeploymentGroup = new CodedeployDeploymentGroup(
            this,
            `ecs_codedeploy_deployment_group`,
            {
                dependsOn: config.dependsOn,
                appName: codeDeployApp.name,
                deploymentConfigName: 'CodeDeployDefault.ECSAllAtOnce',
                deploymentGroupName: `${this.config.serviceName}-ECS`,
                serviceRoleArn: ecsCodeDeployRole.arn,
                autoRollbackConfiguration: {
                    enabled: true,
                    events: ['DEPLOYMENT_FAILURE'],
                },
                blueGreenDeploymentConfig: {
                    deploymentReadyOption: {
                        actionOnTimeout: 'CONTINUE_DEPLOYMENT',
                    },
                    terminateBlueInstancesOnDeploymentSuccess: {
                        action: 'TERMINATE',
                        terminationWaitTimeInMinutes:
                            this.config.blueGreenDeploymentConfig?.terminationWaitTimeInMinutes ??
                            5,
                    },
                },
                deploymentStyle: {
                    deploymentOption: 'WITH_TRAFFIC_CONTROL',
                    deploymentType: 'BLUE_GREEN',
                },
                ecsService: {
                    clusterName: this.config.clusterName,
                    serviceName: this.config.serviceName,
                },
                loadBalancerInfo: {
                    targetGroupPairInfo: {
                        prodTrafficRoute: { listenerArns: [this.config.listenerArn] },
                        targetGroup: this.config.targetGroupNames.map((name) => {
                            return { name }
                        }),
                    },
                },
                tags: this.config.tags,
                provider: this.config.provider,
            },
        )
    }

    /**
     * Set configuration for code deploy notifications
     */

    private getEventTypeIds(
        notifyOnStarted = false,
        notifyOnSucceeded = false,
        notifyOnFailed = true,
    ): string[] {
        const eventTypeIds: string[] = []

        if (notifyOnStarted) {
            eventTypeIds.push('codedeploy-application-deployment-started')
        }

        if (notifyOnSucceeded) {
            eventTypeIds.push('codedeploy-application-deployment-succeeded')
        }

        if (notifyOnFailed) {
            eventTypeIds.push('codedeploy-application-deployment-failed')
        }

        return eventTypeIds
    }

    /**
     * Setup CodeDeploy App, permissions and notifications
     **/

    private setupCodeDeployApp(): CodeDeployResponse {
        const ecsCodeDeployRole = new IamRole(this, `ecs_code_deploy_role`, {
            name: `${this.config.serviceName}-ecs-codedeploy-role`,
            assumeRolePolicy: new DataAwsIamPolicyDocument(this, `ecs_code_deploy_role_assume`, {
                statement: [
                    {
                        effect: 'Allow',
                        actions: ['sts:AssumeRole'],
                        principals: [
                            {
                                identifiers: ['codedeploy.amazonaws.com'],
                                type: 'Service',
                            },
                        ],
                    },
                ],
            }).json,
            tags: this.config.tags,
            provider: this.config.provider,
        })

        new IamRolePolicyAttachment(this, `ecs_code_deploy_role_policy_attachment`, {
            role: ecsCodeDeployRole.name,
            policyArn: 'arn:aws:iam::aws:policy/AWSCodeDeployRoleForECS',
            provider: this.config.provider,
            dependsOn: [ecsCodeDeployRole],
        })

        const codeDeployApp = new CodedeployApp(this, `ecs_codedeploy_app`, {
            computePlatform: 'ECS',
            name: `${this.config.serviceName}-ECS`,
            tags: this.config.tags,
            provider: this.config.provider,
        })

        if (this.config.snsNotificationTopicArn) {
            const region = new DataAwsRegion(this, `current_region`, {
                provider: this.config.provider,
            })

            const account = new DataAwsCallerIdentity(this, `current_account`, {
                provider: this.config.provider,
            })

            new CodestarnotificationsNotificationRule(this, `ecs_codedeploy_notification_rule`, {
                detailType: 'BASIC',
                eventTypeIds: this.getEventTypeIds(
                    this.config.notifications?.notifyOnStarted,
                    this.config.notifications?.notifyOnSucceeded,
                    this.config.notifications?.notifyOnFailed,
                ),
                name: `${codeDeployApp.name}-${this.callerIdentity.accountId}`,
                resource: `arn:aws:codedeploy:${region.name}:${account.accountId}:application:${codeDeployApp.name}`,
                target: [
                    {
                        address: this.config.snsNotificationTopicArn,
                    },
                ],
                tags: this.config.tags,
                provider: this.config.provider,
            })
        }
        return { codeDeployApp, ecsCodeDeployRole }
    }
}
