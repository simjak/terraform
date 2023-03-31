import { Lb, LbConfig } from '@cdktf/provider-aws/lib/lb'
import { SecurityGroup } from '@cdktf/provider-aws/lib/security-group'
import { TerraformMetaArguments } from 'cdktf'
import { Construct } from 'constructs/lib'
export interface ApplicationLoadBalancerProps extends TerraformMetaArguments {
    prefix: string
    alb6CharacterPrefix: string
    vpcId: string
    subnetIds: string[]
    internal?: boolean
    tags?: {
        [key: string]: string
    }
}

export class ApplicationLoadBalancer extends Construct {
    public readonly alb: Lb
    public readonly securityGroup: SecurityGroup

    constructor(scope: Construct, name: string, props: ApplicationLoadBalancerProps) {
        super(scope, name)

        this.securityGroup = new SecurityGroup(this, 'alb_security_group', {
            name: `${props.prefix}-HTTP/S Security Group`,
            description: 'External security group (Managed by Terraform)',
            vpcId: props.vpcId,
            ingress: [
                {
                    fromPort: 80,
                    toPort: 80,
                    protocol: 'tcp',
                    cidrBlocks: ['0.0.0.0/0'],
                },
                {
                    fromPort: 443,
                    toPort: 443,
                    protocol: 'tcp',
                    cidrBlocks: ['0.0.0.0/0'],
                },
            ],
            egress: [
                {
                    fromPort: 0,
                    toPort: 0,
                    protocol: '-1',
                    cidrBlocks: ['0.0.0.0/0'],
                    description: 'required',
                    ipv6CidrBlocks: [],
                    prefixListIds: [],
                    securityGroups: [],
                },
            ],
            tags: {
                ...props.tags,
            },
            lifecycle: {
                createBeforeDestroy: true,
            },
        })

        if (props.internal) {
            this.securityGroup = new SecurityGroup(this, 'alb_internal_security_group', {
                name: `${props.prefix}-lb-internal-sg`,
                description: 'Internal security group (Managed by Terraform)',
                vpcId: props.vpcId,
                ingress: [],
                egress: [
                    {
                        fromPort: 0,
                        toPort: 0,
                        protocol: '-1',
                        cidrBlocks: ['0.0.0.0/0'],
                        description: 'required',
                        ipv6CidrBlocks: [],
                        prefixListIds: [],
                        securityGroups: [],
                    },
                ],
                tags: {
                    ...props.tags,
                },
                lifecycle: {
                    createBeforeDestroy: true,
                },
            })
        }

        const albConfig: LbConfig = {
            name: props.alb6CharacterPrefix,
            securityGroups: [this.securityGroup.id],
            internal: props.internal,
            subnets: props.subnetIds,
            tags: props.tags,
            provider: props.provider,
        }

        this.alb = new Lb(this, 'alb', albConfig)
    }
}
