import { Construct } from 'constructs/lib'
import { EcrRepository, EcrRepositoryConfig } from '@cdktf/provider-aws/lib/ecr-repository'
import {
    EcrLifecyclePolicy,
    EcrLifecyclePolicyConfig,
} from '@cdktf/provider-aws/lib/ecr-lifecycle-policy'
import { TerraformMetaArguments } from 'cdktf'
export interface ApplicationECRProps extends TerraformMetaArguments {
    name: string
    tags?: { [key: string]: string }
}

export class ApplicationECR extends Construct {
    public readonly ecr: EcrRepository
    constructor(scope: Construct, name: string, props: ApplicationECRProps) {
        super(scope, name)

        const ercConfig: EcrRepositoryConfig = {
            name: props.name,
            tags: props.tags,
            encryptionConfiguration: [{ encryptionType: 'KMS' }],
            imageScanningConfiguration: {
                scanOnPush: true,
            },
        }

        this.ecr = new EcrRepository(this, 'ecr', ercConfig)

        const policy = {
            rules: [
                {
                    rulePriority: 1,
                    description: 'expire old images',
                    selection: {
                        tagStatus: 'any',
                        countType: 'imageCountMoreThan',
                        countNumber: 30,
                    },
                    action: {
                        type: 'expire',
                    },
                },
            ],
        }

        const ecrPolicyConfig: EcrLifecyclePolicyConfig = {
            repository: this.ecr.name,
            policy: JSON.stringify(policy),
            dependsOn: [this.ecr],
            provider: props.provider,
        }

        new EcrLifecyclePolicy(this, 'ecr-repo-lifecyclepolicy', ecrPolicyConfig)
    }
}
