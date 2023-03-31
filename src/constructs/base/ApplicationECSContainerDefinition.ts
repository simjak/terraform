interface EnvironmentVariable {
    name: string
    value: string
}

interface EnvironmentFile {
    type: string
    value: string
}

interface SecretEnvironmentVariable {
    name: string
    valueFrom: string
}

interface HealthCheckVariable {
    command: string[]
    interval: number
    retries: number
    startPeriod: number
    timeout: number
}

interface PortMapping {
    containerPort: number
    hostPort: number
    protocol?: string
}

interface MountPoint {
    containerPath: string
    readOnly?: boolean
    sourceVolume: string
}

interface DependsOn {
    containerName: string
    condition: 'START' | 'COMPLETE' | 'SUCCESS' | 'HEALTHY'
}

export interface ContainerDefinition {
    name: string
    image?: string
    cpu: number
    portMappings: PortMapping[]
    essential: boolean
    environment?: EnvironmentVariable[]
    environmentFiles?: EnvironmentFile[]
    mountPoints: any[]
    volumesFrom: any[]
    secrets: SecretEnvironmentVariable[]
    logConfiguration: {
        logDriver: string
        options?: {
            [key: string]: string
        }
    }
    memoryReservation?: number
    entryPoint?: string[]
    command?: string[]
    healthCheck?: HealthCheckVariable
}

export interface ApplicationECSContainerDefinitionProps {
    containerImage?: string
    logGroup?: string
    logGroupRegion?: string
    portMappings?: PortMapping[]
    envVars?: EnvironmentVariable[]
    envFiles?: EnvironmentFile[]
    secretEnvVars?: SecretEnvironmentVariable[]
    command?: string[]
    name: string
    repositoryCredentialsParams?: string
    memoryReservation?: number
    cpu?: number
    healthCheck?: HealthCheckVariable
    mountPoints?: MountPoint[]
    dependsOn?: DependsOn[]
    entryPoint?: string[]
    essentials?: boolean
}

export function buildDefinitionJSON(config: ApplicationECSContainerDefinitionProps): string {
    const containerDefinition: ContainerDefinition = {
        name: config.name,
        image: config.containerImage,
        essential: config.essentials ?? true,
        logConfiguration: {
            logDriver: 'awslogs',
            options: {
                'awslogs-group': config.logGroup ?? '',
                'awslogs-region': config.logGroupRegion ?? 'eu-west-1',
                'awslogs-stream-prefix': config.name,
            },
        },
        entryPoint: config.entryPoint ?? undefined,
        portMappings: config.portMappings ?? [],
        cpu: config.cpu ?? 0,
        environment: config.envVars,
        environmentFiles: config.envFiles,
        secrets: config.secretEnvVars ?? [],
        command: config.command,
        memoryReservation: config.memoryReservation ?? undefined,
        healthCheck: config.healthCheck ?? undefined,
        mountPoints: config.mountPoints ?? [],
        volumesFrom: [],
    }

    if (config.command) {
        containerDefinition.command = config.command
    }

    return JSON.stringify(containerDefinition)
}
