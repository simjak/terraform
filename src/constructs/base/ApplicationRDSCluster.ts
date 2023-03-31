import * as _crypto from 'crypto'
import { RdsCluster, RdsClusterConfig } from '@cdktf/provider-aws/lib/rds-cluster'
import { DataAwsVpc } from '@cdktf/provider-aws/lib/data-aws-vpc'
import { DbSubnetGroup } from '@cdktf/provider-aws/lib/db-subnet-group'
import { SecurityGroup } from '@cdktf/provider-aws/lib/security-group'
import { Construct } from 'constructs/lib'
import { SecretsmanagerSecretVersion } from '@cdktf/provider-aws/lib/secretsmanager-secret-version'
import { RdsClusterInstance } from '@cdktf/provider-aws/lib/rds-cluster-instance'
import { DataAwsSecretsmanagerSecret } from '@cdktf/provider-aws/lib/data-aws-secretsmanager-secret'

export type ApplicationRDSClusterConfig = Omit<
    RdsClusterConfig,
    | 'clusterIdentifierPrefix'
    | 'vpcSecurityGroupIds'
    | 'dbSubnetGroupName'
    | 'copyTagsToSnapshot'
    | 'tags'
    | 'lifecycle'
> & {
    masterUsername: string
    masterPassword?: string
    engine?: 'aurora-postgresql' // | 'aurora-mysql' | 'aurora'
    instanceClass?: string
    backupRetentionPeriod?: number // default 1
    deletionProtection?: boolean // default true
}

export type ApplicationRDSClusterProps = {
    prefix: string
    vpcId: string
    subnetIds: string[]
    rdsConfig: ApplicationRDSClusterConfig
    secretLocation?: string
    additionalSecrets?: { [key: string]: string }
    tags?: { [key: string]: string }
}

export class ApplicationRDSCluster extends Construct {
    public readonly rds: RdsCluster
    public readonly secretVersion: SecretsmanagerSecretVersion

    constructor(scope: Construct, name: string, props: ApplicationRDSClusterProps) {
        super(scope, name)

        const appVpc = new DataAwsVpc(this, `vpc`, {
            filter: [
                {
                    name: 'vpc-id',
                    values: [props.vpcId],
                },
            ],
        })

        const securityGroup = new SecurityGroup(this, 'rds-security-group', {
            name: props.prefix,
            description: 'RDS SG, Managed by Terraform',
            vpcId: appVpc.id,
            ingress: [
                {
                    fromPort: props.rdsConfig.port,
                    toPort: props.rdsConfig.port,
                    protocol: 'tcp',
                    cidrBlocks: [appVpc.cidrBlock],
                },
            ],
            egress: [
                {
                    fromPort: 0,
                    toPort: 0,
                    protocol: '-1',
                    cidrBlocks: ['0.0.0.0/0'],
                },
            ],
        })

        const subnetGroup = new DbSubnetGroup(this, 'rds-subnet-group', {
            name: props.prefix.toLowerCase(),
            subnetIds: props.subnetIds,
        })

        this.rds = new RdsCluster(this, 'rds-cluster', {
            ...props.rdsConfig,
            clusterIdentifier: `${props.prefix.toLowerCase()}-cluster`,
            tags: props.tags,
            copyTagsToSnapshot: true,
            storageEncrypted: true,
            masterPassword:
                props.rdsConfig.masterPassword ?? _crypto.randomBytes(8).toString('hex'),
            vpcSecurityGroupIds: [securityGroup.id],
            dbSubnetGroupName: subnetGroup.name,
            skipFinalSnapshot: false,
            finalSnapshotIdentifier: `${props.prefix.toLowerCase()}-final-snapshot-${Date.now()}`,
            lifecycle: {
                ignoreChanges: [
                    'final_snapshot_identifier', // we don't want to change the name of the final snapshot on every deploy
                ],
            },
            backupRetentionPeriod: props.rdsConfig.backupRetentionPeriod,
            deletionProtection: props.rdsConfig.deletionProtection || true,
        })

        new RdsClusterInstance(this, 'rds-cluster-instance', {
            identifier: `${props.prefix.toLowerCase()}-instance`,
            clusterIdentifier: this.rds.clusterIdentifier,
            instanceClass: props.rdsConfig.instanceClass ?? 'db.t3.medium',
            engine: props.rdsConfig.engine ?? 'aurora-postgresql',
            engineVersion: props.rdsConfig.engineVersion,
            
        })

        // Create secrets manager resource for the RDS
        const { secretVersion } = ApplicationRDSCluster.createRdsSecret(this, this.rds, props)

        this.secretVersion = secretVersion
    }

    private static createRdsSecret(
        scope: Construct,
        rds: RdsCluster,
        props: ApplicationRDSClusterProps,
    ): { secretVersion: SecretsmanagerSecretVersion } {
        // Create secret
        const rdsSecret = new DataAwsSecretsmanagerSecret(scope, 'data_rds_backend_secret', {
            name: props.secretLocation,
        })

        const secretValue: {
            host: string
        } = {
            host: rds.endpoint,
        }

        // use default value config, but update any user-provided additional values
        const updatedSecretValue = {
            ...secretValue,
            ...props.additionalSecrets,
        }

        //Add values to secret
        const secretVersion = new SecretsmanagerSecretVersion(scope, 'rds-secret-version', {
            secretId: rdsSecret.id,
            secretString: JSON.stringify(updatedSecretValue),
            dependsOn: [rdsSecret],
        })

        return { secretVersion: secretVersion }
    }
}
