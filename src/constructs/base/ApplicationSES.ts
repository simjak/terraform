import { SesDomainDkim } from '@cdktf/provider-aws/lib/ses-domain-dkim'
import { SesDomainIdentity } from '@cdktf/provider-aws/lib/ses-domain-identity'
import { SesEmailIdentity } from '@cdktf/provider-aws/lib/ses-email-identity'
import { Construct } from 'constructs/lib'

export interface ApplicationSESProps {
    domain: string
    validEmails?: string[]
    tags?: { [key: string]: string }
}

export class ApplicationSES extends Construct {
    constructor(scope: Construct, id: string, { domain, validEmails }: ApplicationSESProps) {
        {
            super(scope, id)

            const indentity = new SesDomainIdentity(this, 'domain_identity', {
                domain: domain,
            })

            new SesDomainDkim(this, 'domain_dkim', {
                domain: indentity.domain,
            })

            validEmails?.map((validEmail) => {
                new SesEmailIdentity(this, `email_identity_${validEmail}`, {
                    email: validEmail,
                })
            })
        }
    }
}
