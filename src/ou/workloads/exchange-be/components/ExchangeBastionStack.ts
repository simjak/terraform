import { ThalloBastionHost } from '../../../../constructs/thallo/ThalloBastionHost'
import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { TerraformStack, S3Backend, Fn } from 'cdktf'
import { Construct } from 'constructs/lib'
import {
    getVpcParameters,
    ThalloApplicationConfig,
    createApplicationConfig,
} from '../../../../constructs/thallo/ThalloApplicationConfig'
import { exchangeConfigInput } from '../ExchangeConfig'

export class ExchangeBastionStack extends TerraformStack {
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
            key: `tf-state/${this.config.serviceName}-${this.config.aws.account.target}-bastion.json`,
            region: this.config.aws.region,
        })

        const vpcData = getVpcParameters(this, this.config.secretsLocation.vpc)

        new ThalloBastionHost(this, `${this.config.serviceName}_bastion`, {
            prefix: this.config.serviceName,
            vpcId: vpcData.vpcId,
            subnetId: Fn.element(vpcData.publicSubnetIds, 0),
            instanceType: 't3.micro',
            tags: this.config.tags,
        })
    }
}
