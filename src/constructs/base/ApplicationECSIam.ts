import {
    DataAwsIamPolicyDocument,
    DataAwsIamPolicyDocumentStatement,
} from '@cdktf/provider-aws/lib/data-aws-iam-policy-document'
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy'
import { IamRole } from '@cdktf/provider-aws/lib/iam-role'
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment'
import { Construct } from 'constructs/lib'

export interface ApplicationECSIamProps {
    prefix: string
    taskExecutionRolePolicyStatements: DataAwsIamPolicyDocumentStatement[]
    taskRolePolicyStatements: DataAwsIamPolicyDocumentStatement[]
    taskExecutionDefaultAttachmentArn?: string
    tags?: { [key: string]: string }
}

export class ApplicationECSIam extends Construct {
    public readonly taskExecutionRoleArn
    public readonly taskRoleArn
    public readonly taskRole: IamRole

    constructor(scope: Construct, id: string, config: ApplicationECSIamProps) {
        super(scope, id)

        const dataEcsTaskAssume = new DataAwsIamPolicyDocument(this, 'ecs-task-assume', {
            version: '2012-10-17',
            statement: [
                {
                    effect: 'Allow',
                    actions: ['sts:AssumeRole'],
                    principals: [
                        {
                            identifiers: [
                                'ecs-tasks.amazonaws.com',
                                'application-autoscaling.amazonaws.com',
                            ],
                            type: 'Service',
                        },
                    ],
                },
            ],
        })

        const ecsTaskExecutionRole = new IamRole(this, `${config.prefix}-task-execution-role`, {
            name: `${config.prefix}-task-execution-role`,
            assumeRolePolicy: dataEcsTaskAssume.json,
            tags: config.tags,
        })

        if (config.taskExecutionDefaultAttachmentArn) {
            new IamRolePolicyAttachment(
                this,
                `${config.prefix}-task-execution-default-attachment`,
                {
                    policyArn: config.taskExecutionDefaultAttachmentArn,
                    role: ecsTaskExecutionRole.name,
                },
            )
        }

        if (config.taskExecutionRolePolicyStatements.length > 0) {
            const dataEcsTaskExecutionPolicy = new DataAwsIamPolicyDocument(
                this,
                `data-task-execution-role-policy`,
                {
                    version: '2012-10-17',
                    statement: config.taskExecutionRolePolicyStatements,
                },
            )

            const ecsTaskExecutionRolePolicy = new IamPolicy(this, `ecs-task-execution-policy`, {
                name: `${config.prefix}-task-execution-policy`,
                policy: dataEcsTaskExecutionPolicy.json,
            })

            new IamRolePolicyAttachment(this, `${config.prefix}-task-execution-policy-attachment`, {
                policyArn: ecsTaskExecutionRolePolicy.arn,
                role: ecsTaskExecutionRole.name,
            })
        }

        const ecsTaskRole = new IamRole(this, `${config.prefix}-ecs-task-role`, {
            assumeRolePolicy: dataEcsTaskAssume.json,
            name: `${config.prefix}-ecs-task-role`,
            tags: config.tags,
        })

        if (config.taskRolePolicyStatements.length > 0) {
            const dataEcsTaskPolicy = new DataAwsIamPolicyDocument(
                this,
                `${config.prefix}-data-ecs-task-policy`,
                {
                    version: '2012-10-17',
                    statement: config.taskRolePolicyStatements,
                },
            )
            const ecsTaskRolePolicy = new IamPolicy(this, `${config.prefix}-ecs-task-role-policy`, {
                name: `${config.prefix}-ecs-task-role-policy`,
                policy: dataEcsTaskPolicy.json,
            })

            new IamRolePolicyAttachment(this, `${config.prefix}-ecs-task-role-policy-attachment`, {
                policyArn: ecsTaskRolePolicy.arn,
                role: ecsTaskRole.id,
            })
        }

        // available for other constructs to use
        this.taskExecutionRoleArn = ecsTaskExecutionRole.arn
        this.taskRoleArn = ecsTaskRole.arn
        this.taskRole = ecsTaskRole
    }
}
