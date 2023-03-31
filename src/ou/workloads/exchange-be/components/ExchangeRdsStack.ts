import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { S3Backend, TerraformStack } from 'cdktf'
import { Construct } from 'constructs/lib'
import { ApplicationRDSCluster } from '../../../../constructs/base/ApplicationRDSCluster'
import {
    getDeploymentParameters,
    getVpcParameters,
    ThalloApplicationConfig,
    createApplicationConfig,
} from '../../../../constructs/thallo/ThalloApplicationConfig'
import { readJSONSecretKey } from '../../../../utils/utils'
import { exchangeConfigInput } from '../ExchangeConfig'

export class ExchangeRdsStack extends TerraformStack {
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
            key: `tf-state/${this.config.serviceName}-${this.config.aws.account.target}-rds.json`,
            region: this.config.aws.region,
        })

        const vpcData = getVpcParameters(this, this.config.secretsLocation.vpc)
        const deploymentParams = getDeploymentParameters(this, this.config.secretsLocation)
        const rdsSecretLocation = this.config.secretsLocation.rds

        new ApplicationRDSCluster(this, 'rds', {
            prefix: `${this.config.serviceName}`,
            vpcId: vpcData.vpcId,
            subnetIds: vpcData.databaseSubnetIds,
            rdsConfig: {
                databaseName: this.config.database.name,
                masterUsername: this.config.database.masterUsername,
                masterPassword: readJSONSecretKey(
                    deploymentParams.deploymentSecret,
                    'postgresPassword',
                ),
                engine: 'aurora-postgresql',
                engineVersion: '13.8',
                backupRetentionPeriod: 3,
                instanceClass: this.config.database.instanceClass,
                port: this.config.database.port,
                deletionProtection: true,
            },
            secretLocation: rdsSecretLocation,
            tags: this.config.tags,
        })
    }
}
