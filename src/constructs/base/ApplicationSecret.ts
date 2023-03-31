import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret'
import { SecretsmanagerSecretVersion } from '@cdktf/provider-aws/lib/secretsmanager-secret-version'
import { Construct } from 'constructs/lib'

export type ApplicationSecretProps = {
    name: string
    description?: string
    secretLocation: string
    secretValues: { [key: string]: string }
    tags?: { [key: string]: string }
}

export class ApplicationSecret extends Construct {
    public readonly secretVersion: SecretsmanagerSecretVersion
    public readonly secretLocation: string
    constructor(scope: Construct, name: string, props: ApplicationSecretProps) {
        super(scope, name)

        this.secretLocation = props.secretLocation

        const secret = new SecretsmanagerSecret(scope, `${props.name}_secret`, {
            name: props.secretLocation,
            description: props.description,
            recoveryWindowInDays: 0, //NOTE: Set to 0 to disable recovery
            tags: props.tags,
            lifecycle: {
                ignoreChanges: ['name'],
            },
        })

        const secretValue = {
            ...props.secretValues,
        }

        //Add values to secret
        this.secretVersion = new SecretsmanagerSecretVersion(
            scope,
            `${props.name}_secret_version`,
            {
                secretId: secret.id,
                secretString: JSON.stringify(secretValue),
                dependsOn: [secret],
            },
        )
    }
}
