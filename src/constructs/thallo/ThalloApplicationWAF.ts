import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group'
import { Wafv2WebAcl } from '@cdktf/provider-aws/lib/wafv2-web-acl'
import { Wafv2WebAclAssociation } from '@cdktf/provider-aws/lib/wafv2-web-acl-association'
import { Wafv2WebAclLoggingConfiguration } from '@cdktf/provider-aws/lib/wafv2-web-acl-logging-configuration'
import { Construct } from 'constructs/lib'

export interface ApplicationWAFProps {
    name: string
    associatedResources: string[]
    tags: { [key: string]: string }
}

export class ThalloApplicationWAF extends Construct {
    constructor(scope: Construct, name: string, config: ApplicationWAFProps) {
        super(scope, name)

        const applicationWaf = new Wafv2WebAcl(scope, config.name, {
            name: config.name,
            defaultAction: {
                allow: {},
            },
            scope: 'REGIONAL',
            visibilityConfig: {
                cloudwatchMetricsEnabled: true,
                metricName: config.name,
                sampledRequestsEnabled: true,
            },

            rule: [
                // Amazon IP reputation list
                {
                    name: 'AWSManagedRulesAmazonIpReputationList',
                    priority: 1,
                    statement: {
                        managedRuleGroupStatement: {
                            name: 'AWSManagedRulesAmazonIpReputationList',
                            vendorName: 'AWS',
                        },
                    },
                    visibilityConfig: {
                        cloudwatchMetricsEnabled: true,
                        metricName: 'AWSManagedRulesAmazonIpReputationList',
                        sampledRequestsEnabled: true,
                    },
                    overrideAction: {
                        none: {},
                    },
                },
                // Core rule set
                {
                    name: 'AWSManagedRulesCommonRuleSet',
                    priority: 2,
                    statement: {
                        managedRuleGroupStatement: {
                            name: 'AWSManagedRulesCommonRuleSet',
                            vendorName: 'AWS',
                        },
                    },
                    visibilityConfig: {
                        cloudwatchMetricsEnabled: true,
                        metricName: 'AWSManagedRulesCommonRuleSet',
                        sampledRequestsEnabled: true,
                    },
                    overrideAction: {
                        none: {},
                    },
                },
                // Known bad inputs
                {
                    name: 'AWSManagedRulesKnownBadInputsRuleSet',
                    priority: 3,
                    statement: {
                        managedRuleGroupStatement: {
                            name: 'AWSManagedRulesKnownBadInputsRuleSet',
                            vendorName: 'AWS',
                        },
                    },
                    visibilityConfig: {
                        cloudwatchMetricsEnabled: true,
                        metricName: 'AWSManagedRulesKnownBadInputsRuleSet',
                        sampledRequestsEnabled: true,
                    },
                    overrideAction: {
                        none: {},
                    },
                },
                // Linux operating system
                {
                    name: 'AWSManagedRulesLinuxRuleSet',
                    priority: 4,
                    statement: {
                        managedRuleGroupStatement: {
                            name: 'AWSManagedRulesLinuxRuleSet',
                            vendorName: 'AWS',
                        },
                    },
                    visibilityConfig: {
                        cloudwatchMetricsEnabled: true,
                        metricName: 'AWSManagedRulesLinuxRuleSet',
                        sampledRequestsEnabled: true,
                    },
                    overrideAction: {
                        none: {},
                    },
                },
                // SQL database
                {
                    name: 'AWSManagedRulesSQLiRuleSet',
                    priority: 5,
                    statement: {
                        managedRuleGroupStatement: {
                            name: 'AWSManagedRulesSQLiRuleSet',
                            vendorName: 'AWS',
                        },
                    },
                    visibilityConfig: {
                        cloudwatchMetricsEnabled: true,
                        metricName: 'AWSManagedRulesSQLiRuleSet',
                        sampledRequestsEnabled: true,
                    },
                    overrideAction: {
                        none: {},
                    },
                },
            ],
            tags: config.tags,
        })

        for (let i = 0; i < config.associatedResources.length; i++) {
            new Wafv2WebAclAssociation(scope, `${config.name}_waf_association_${i}`, {
                resourceArn: config.associatedResources[i],
                webAclArn: applicationWaf.arn,
            })
        }

        // WAF logging
        const cloudwatchLogGroup = new CloudwatchLogGroup(scope, `${config.name}_waf_log_group`, {
            name: `aws-waf-logs-${config.name}`,
            retentionInDays: 7,
            tags: config.tags,
        })

        new Wafv2WebAclLoggingConfiguration(scope, `${config.name}_waf_logging`, {
            resourceArn: applicationWaf.arn,
            logDestinationConfigs: [cloudwatchLogGroup.arn],
            dependsOn: [cloudwatchLogGroup],
        })
    }
}
