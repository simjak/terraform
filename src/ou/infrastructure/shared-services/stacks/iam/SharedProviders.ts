import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { Construct } from 'constructs'
import { config } from '../../SharedConfig'

export function setProvider(scope: Construct, accountId: string): AwsProvider {
    return new AwsProvider(scope, accountId, {
        profile: config.aws.local.profile,
        region: config.aws.region,
        assumeRole: [
            {
                roleArn: `arn:aws:iam::${accountId}:role/terraform-admin-role`,
            },
        ],
        alias: `remote-${accountId}`,
    })
}
