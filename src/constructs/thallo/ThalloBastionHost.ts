import { Eip } from '@cdktf/provider-aws/lib/eip'
import { EipAssociation } from '@cdktf/provider-aws/lib/eip-association'
import { Instance } from '@cdktf/provider-aws/lib/instance'
import { SecurityGroup } from '@cdktf/provider-aws/lib/security-group'
import { TerraformOutput } from 'cdktf'
import { Construct } from 'constructs/lib'

export type ThalloBastionHostProps = {
    prefix: string
    vpcId: string
    subnetId: string
    ami?: string
    instanceType?: string
    keyName?: string
    whitelistCidrBlocks?: string[]
    tags: { [key: string]: string }
}

export class ThalloBastionHost extends Construct {
    public readonly instance: Instance
    public readonly elasticIp: Eip
    constructor(scope: Construct, name: string, config: ThalloBastionHostProps) {
        super(scope, name)

        const bastionSecurityGroup = new SecurityGroup(this, 'bastion_security_group', {
            name: `${config.prefix}-bastion-main`,
            description: 'Allow SSH to Bastion host, managed by Terraform',

            ingress: [
                {
                    description: 'Allow SSH from whitelisted CIDR blocks',
                    fromPort: 22,
                    toPort: 22,
                    protocol: 'tcp',
                    // https://github.com/joetek/aws-ip-ranges-json/blob/master/ip-ranges-ec2-instance-connect.json
                    cidrBlocks: [''], 
                },
            ],
            egress: [
                {
                    description: 'Allow all outbound traffic',
                    fromPort: 0,
                    toPort: 0,
                    protocol: '-1',
                    cidrBlocks: ['0.0.0.0/0'],
                },
            ],
            tags: config.tags,
            vpcId: config.vpcId,
        })

        this.elasticIp = new Eip(this, `${config.prefix}-bastion-eip`, {
            vpc: true,
            tags: { ...config.tags, Name: `${config.prefix}-bastion` },
        })

        this.instance = new Instance(this, 'bastion_host', {
            keyName: config.keyName,
            ami: config.ami ?? 'ami-096800910c1b781ba', // public AMI for Ubuntu 22.04s
            instanceType: config.instanceType ?? 't3.nano',
            subnetId: config.subnetId,
            securityGroups: [bastionSecurityGroup.id],
            userData:
                '#!/bin/bash \n \
            apt-get install -y postgresql-client-common postgresql postgresql-client ec2-instance-connect',
            userDataReplaceOnChange: true,
            tags: { ...config.tags, Name: `${config.prefix}-bastion` },
        })

        new EipAssociation(this, 'bastion_eip_association', {
            allocationId: this.elasticIp.allocationId,
            instanceId: this.instance.id,
        })

        new TerraformOutput(this, 'bastion_host_public_ip', {
            value: this.elasticIp.publicIp,
        })
    }
}
