import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { S3Backend, TerraformStack } from 'cdktf'
import { Construct } from 'constructs/lib'
import { exchangeConfigInput } from '../ExchangeConfig'
import {
    ThalloApplicationConfig,
    createApplicationConfig,
} from '../../../../constructs/thallo/ThalloApplicationConfig'
import { ThalloVpc } from '../../../../constructs/thallo/ThalloVpc'

export class ExchangeVpcStack extends TerraformStack {
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
            key: `tf-state/${this.config.serviceName}-${this.config.aws.account.target}-vpc.json`,
            region: this.config.aws.region,
        })

        new ThalloVpc(this, `${this.config.serviceName}_vpc`, {
            region: this.config.aws.region,
            cidrBlock: '',
            prefix: this.config.serviceName,
            secretLocation: this.config.secretsLocation.vpc,
            availabilityZones: this.config.aws.availabilityZones,
            tags: this.config.tags,
        })
    }
}
