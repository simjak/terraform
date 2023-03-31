import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule'
import {
    CloudwatchEventTarget,
    CloudwatchEventTargetConfig,
} from '@cdktf/provider-aws/lib/cloudwatch-event-target'
import { TerraformMetaArguments, TerraformResource } from 'cdktf'
import { Construct } from 'constructs'

export type Target = {
    arn: string
    deadLetterArn?: string
    targetId: string
    // an event bridge rule may have a target that already exists. in this case,
    // we don't need a dependsOn value.
    dependsOn?: TerraformResource
}

export interface ApplicationEventBridgeRuleProps extends TerraformMetaArguments {
    name: string
    description?: string
    eventBusName?: string
    roleArn?: string
    /**
     * (Optional) The event pattern described a JSON object.
     * At least one of `schedule_expression` or `event_pattern` is required. */
    eventPattern?: { [key: string]: any }
    /**
     * (Optional) The scheduling expression.
     * For example, cron(0 20 * * ? *) or rate(5 minutes).
     * At least one of `schedule_expression` or `event_pattern` is required.
     * Only available on the default event bus. */
    scheduleExpression?: string
    targets?: Target[]
    tags?: { [key: string]: string }
    preventDestroy?: boolean
}

export class ApplicationEventBridgeRule extends Construct {
    public readonly rule: CloudwatchEventRule
    constructor(scope: Construct, name: string, private config: ApplicationEventBridgeRuleProps) {
        super(scope, name)

        this.rule = this.createCloudwatchEventRule()
    }
    private createCloudwatchEventRule(): CloudwatchEventRule {
        const eventBus = this.config.eventBusName ?? 'default'
        const { scheduleExpression, eventPattern } = this.config
        const rule = new CloudwatchEventRule(this, 'event-bridge-rule', {
            name: `${this.config.name}-rule`,
            roleArn: this.config.roleArn,
            description: this.config.description,
            eventPattern: eventPattern ? JSON.stringify(eventPattern) : undefined,
            scheduleExpression,
            eventBusName: eventBus,
            lifecycle: {
                preventDestroy: this.config.preventDestroy,
            },
            tags: this.config.tags,
            provider: this.config.provider,
        })

        if (this.config.targets) {
            if (this.config.targets?.length > 5) {
                throw new Error('AWS allows only up to 5 targets per event bridge rule')
            }
            this.config.targets.forEach((target) => {
                const eventTargetConfig: { [key: string]: any } = {
                    rule: rule.name,
                    roleArn: this.config.roleArn,
                    targetId: target.targetId,
                    arn: target.arn,
                    deadLetterConfig: target.deadLetterArn ? { arn: target.deadLetterArn } : {},
                    eventBusName: eventBus,
                }
                if (target.dependsOn) {
                    eventTargetConfig.dependsOn = [target.dependsOn, rule]
                }

                new CloudwatchEventTarget(
                    this,
                    `event-bridge-target-${target.targetId}`,
                    eventTargetConfig as CloudwatchEventTargetConfig,
                )
            })
        }
        return rule
    }
}
