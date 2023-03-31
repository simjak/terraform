import { ThalloAccountRegistry } from './../../../../../constructs/thallo/ThalloAccountRegistry'
import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { S3Backend, TerraformStack } from 'cdktf'
import { Construct } from 'constructs/lib'
import { config } from '../../SharedConfig'
import { SesEmailIdentity } from '@cdktf/provider-aws/lib/ses-email-identity'
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document'
import { SesIdentityPolicy } from '@cdktf/provider-aws/lib/ses-identity-policy'
import { SesDomainIdentity } from '@cdktf/provider-aws/lib/ses-domain-identity'

export class SharedSesStack extends TerraformStack {
    constructor(scope: Construct, id: string) {
        super(scope, id)

        new AwsProvider(this, 'aws', {
            profile: config.aws.local.profile,
            region: config.aws.region,
            assumeRole: [
                {
                    roleArn: `arn:aws:iam::${ThalloAccountRegistry.infrastructure.sharedServices}:role/terraform-build-role`,
                },
            ],
        })

        new S3Backend(this, {
            profile: config.aws.local.profile,
            roleArn: `arn:aws:iam::${ThalloAccountRegistry.infrastructure.sharedServices}:role/terraform-build-role`,
            bucket: `tf-state.shared-${ThalloAccountRegistry.infrastructure.sharedServices}`,
            key: `tf-state/shared-${ThalloAccountRegistry.infrastructure.sharedServices}-ses.json`,
            region: config.aws.region,
        })

        const emailIdentities = [
            'support.test+demo@thallo.io',
            'support.test+staging@thallo.io',
            'buycredits.test+demo@thallo.io',
            'buycredits.test+staging@thallo.io',
        ]

        emailIdentities?.map((email, index) => {
            this.setEmailIdentity(email, index)
        })

        const domainIdentities = ['thallo.io', 'thallotest.com']

        domainIdentities?.map((domain, index) => {
            this.setDomainIdentity(domain, index)
        })
    }

    private setEmailIdentity(email: string, index: number): SesEmailIdentity {
        const identity = new SesEmailIdentity(this, `email_identity_${index}`, {
            email: email,
        })

        const policy = new DataAwsIamPolicyDocument(
            this,
            `data_email_identity_policy_document_${index}`,
            {
                statement: [
                    {
                        actions: ['SES:SendRawEmail', 'SES:SendEmail'],
                        effect: 'Allow',
                        principals: [
                            {
                                identifiers: [
                                    `arn:aws:iam::${ThalloAccountRegistry.workloads.demo.exchange}:root`,
                                    `arn:aws:iam::${ThalloAccountRegistry.workloads.staging.exchange}:root`,
                                ],
                                type: 'AWS',
                            },
                        ],
                        resources: [identity.arn],
                    },
                ],
            },
        ).json

        new SesIdentityPolicy(this, `email_identity_policy_${index}`, {
            name: `email_identity_policy_${index}`,
            identity: identity.arn,
            policy: policy,
        })

        return identity
    }

    private setDomainIdentity(domain: string, index: number): SesDomainIdentity {
        const identity = new SesDomainIdentity(this, `domain_identity_${index}`, {
            domain: domain,
        })

        const policy = new DataAwsIamPolicyDocument(
            this,
            `data_domain_identity_policy_document_${index}`,
            {
                statement: [
                    {
                        actions: ['SES:SendRawEmail', 'SES:SendEmail'],
                        effect: 'Allow',
                        principals: [
                            {
                                identifiers: [
                                    `arn:aws:iam::${ThalloAccountRegistry.workloads.demo.exchange}:root`,
                                    `arn:aws:iam::${ThalloAccountRegistry.workloads.staging.exchange}:root`,
                                ],
                                type: 'AWS',
                            },
                        ],
                        resources: [identity.arn],
                    },
                ],
            },
        ).json

        new SesIdentityPolicy(this, `domain_identity_policy_${index}`, {
            name: `domain_identity_policy_${index}`,
            identity: identity.arn,
            policy: policy,
        })

        return identity
    }
}
