import {
    DataAwsIamPolicyDocument,
    DataAwsIamPolicyDocumentStatement,
} from '@cdktf/provider-aws/lib/data-aws-iam-policy-document'
import { EcrRepositoryPolicy } from '@cdktf/provider-aws/lib/ecr-repository-policy'
import { Construct } from 'constructs/lib'

export interface ApplicationECRIamProps {
    prefix: string
    repositoryName: string
    ecrPolicyStatements: DataAwsIamPolicyDocumentStatement[]
    tags?: { [key: string]: string }
}

export class ApplicationECRIam extends Construct {
    constructor(scope: Construct, id: string, config: ApplicationECRIamProps) {
        super(scope, id)

        if (config.ecrPolicyStatements) {
            const dataEcsTaskExecutionPolicy = new DataAwsIamPolicyDocument(
                this,
                `data-task-execution-role-policy`,
                {
                    version: '2012-10-17',
                    statement: config.ecrPolicyStatements,
                },
            )

            new EcrRepositoryPolicy(this, 'ecr_iam', {
                repository: config.repositoryName,
                policy: dataEcsTaskExecutionPolicy.json,
            })
        }
    }
}
