import { ApplicationSecret } from './ApplicationSecret'
import { SqsQueue } from '@cdktf/provider-aws/lib/sqs-queue'
import { Construct } from 'constructs/lib'

export interface ApplicationSQSQueueProps {
    name: string
    messageRetentionSeconds?: number
    maxReceiveCount?: number
    maxMessageSize?: number
    delaySeconds?: number
    visibilityTimeoutSeconds?: number
    receiveWaitTimeSeconds?: number
    secretLocation: string
    tags?: { [key: string]: string }
}

const validations: {
    [key: string]: {
        min: number
        max: number
    }
} = {
    visibilityTimeoutSeconds: {
        min: 0,
        max: 43200,
    },
    messageRetentionSeconds: {
        min: 60,
        max: 1209600,
    },
    maxMessageSize: {
        min: 1024,
        max: 262144,
    },
    delaySeconds: {
        min: 0,
        max: 900,
    },
    receiveWaitTimeSeconds: {
        min: 0,
        max: 20,
    },
}

export class ApplicationSQSQueue extends Construct {
    public readonly sqsQueue: SqsQueue
    public deadLetterQueue: SqsQueue | undefined
    public sqsSecret: ApplicationSecret
    constructor(scope: Construct, name: string, config: ApplicationSQSQueueProps) {
        super(scope, name)
        ApplicationSQSQueue.validateConfig(config)
        this.sqsQueue = this.createSQSQueue(config)

        //Add SQS parameters to the secret
        this.sqsSecret = new ApplicationSecret(this, 'sqs_secret', {
            name: `${config.name}_sqs`,
            description: `Secret for SQS queue ${config.name}, managed by Terraform`,
            secretLocation: config.secretLocation,
            secretValues: {
                sqsQueueUrl: this.sqsQueue.url,
            },
        })
    }

    private static validateConfig(config: ApplicationSQSQueueProps): void {
        for (const [key, valueToValidate] of Object.entries(config)) {
            if (!validations[key]) {
                // The key value does not exist in the validations constant so no need to validate it
                continue
            }
            const { min, max } = validations[key]
            if (valueToValidate < min || valueToValidate > max) {
                throw new Error(`The value for ${key} must be between ${min} and ${max}`)
            }
        }
    }

    private createSQSQueue(config: ApplicationSQSQueueProps): SqsQueue {
        //Have to use the `any` type because SqsQueueConfig marks the properties as readonly
        const sqsConfig: any = {
            name: config.name,
            messageRetentionSeconds: config.messageRetentionSeconds,
            maxMessageSize: config.maxMessageSize,
            delaySeconds: config.delaySeconds,
            visibilityTimeoutSeconds: config.visibilityTimeoutSeconds,
            receiveWaitTimeSeconds: config.receiveWaitTimeSeconds,
            tags: config.tags,
            fifoQueue: true,
        }

        if (config.maxReceiveCount && config.maxReceiveCount > 0) {
            this.deadLetterQueue = new SqsQueue(this, 'deadLetterQueue', {
                name: `${config.name}-dead-letter-queue`,
                fifoQueue: true,
            })
            sqsConfig.redrivePolicy = {
                deadLetterTargetArn: this.deadLetterQueue.arn,
                maxReceiveCount: config.maxReceiveCount,
            }
        }

        return new SqsQueue(this, 'sqsQueue', sqsConfig)
    }
}
