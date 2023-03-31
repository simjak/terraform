import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { TerraformStack, S3Backend } from 'cdktf'
import { Construct } from 'constructs/lib'
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket'
import { S3BucketVersioningA } from '@cdktf/provider-aws/lib/s3-bucket-versioning'
import { S3BucketPublicAccessBlock } from '@cdktf/provider-aws/lib/s3-bucket-public-access-block'
import { ApplicationSecret } from '../../../../constructs/base/ApplicationSecret'
import {
    ThalloApplicationConfig,
    createApplicationConfig,
} from '../../../../constructs/thallo/ThalloApplicationConfig'
import { exchangeConfigInput } from '../ExchangeConfig'

export class ExchangeBucketStack extends TerraformStack {
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
            key: `tf-state/${this.config.serviceName}-${this.config.aws.account.target}-bucket.json`,
            region: this.config.aws.region,
        })

        const envVarsBucket = this.createEnvVarsBucket()

        /**
         * Bucket params to secret
         */
        new ApplicationSecret(this, 'buckets_params_secret', {
            name: 'buckets_params_secret',
            description: `Buckets params for ${this.config.serviceName}, managed by Terraform`,
            secretLocation: this.config.secretsLocation.bucket,
            secretValues: {
                envVarsBucketName: envVarsBucket.bucket,
                envVarsBucketArn: envVarsBucket.arn,
            },
        })
    }
    createEnvVarsBucket(): S3Bucket {
        const envVarsBucket = new S3Bucket(this, 'env_vars_s3_bucket', {
            bucket: `thallo.env-vars.${this.config.serviceName}-${this.config.environment}-${this.config.aws.account.target}`,
            tags: this.config.tags,
        })

        new S3BucketVersioningA(this, 's3_env_vars_bucket_versioning', {
            bucket: envVarsBucket.id,
            versioningConfiguration: { status: 'Enabled' },
        })

        new S3BucketPublicAccessBlock(this, 's3_env_vars_bucket_public_access_block', {
            bucket: envVarsBucket.id,
            blockPublicAcls: true,
            blockPublicPolicy: true,
            ignorePublicAcls: true,
            restrictPublicBuckets: true,
        })

        return envVarsBucket
    }
}
