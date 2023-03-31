import { S3Object } from '@cdktf/provider-aws/lib/s3-object'
import { EcrRepository } from '@cdktf/provider-aws/lib/ecr-repository'
import { ApplicationECSIam, ApplicationECSIamProps } from './ApplicationECSIam'
import {
    ApplicationECSContainerDefinitionProps,
    buildDefinitionJSON,
    ContainerDefinition,
} from './ApplicationECSContainerDefinition'
import {
    EcsTaskDefinition,
    EcsTaskDefinitionVolume,
} from '@cdktf/provider-aws/lib/ecs-task-definition'
import {
    EcsService,
    EcsServiceLoadBalancer,
    EcsServiceNetworkConfiguration,
} from '@cdktf/provider-aws/lib/ecs-service'
import {
    SecurityGroup,
    SecurityGroupEgress,
    SecurityGroupIngress,
} from '@cdktf/provider-aws/lib/security-group'
import { Construct } from 'constructs/lib'
import { Fn, TerraformMetaArguments, TerraformResource } from 'cdktf'
import { ApplicationTargetGroup } from './ApplicationTargetGroup'
import { AlbListenerRule } from '@cdktf/provider-aws/lib/alb-listener-rule'
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group'
import { ApplicationECSAlbCodeDeploy } from './ApplicationECSAlbCodeDeploy'
import { Resource } from '@cdktf/provider-null/lib/resource'
import { truncateString } from '../../utils/utils'
import { stringify } from 'yaml'
import { S3BucketVersioningA } from '@cdktf/provider-aws/lib/s3-bucket-versioning'
import { S3BucketPublicAccessBlock } from '@cdktf/provider-aws/lib/s3-bucket-public-access-block'
import { ApplicationECR, ApplicationECRProps } from './ApplicationECR'
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity'
import { Environment, ThalloService } from '../thallo/ThalloApplicationConfig'
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket'
import { DataArchiveFile } from '@cdktf/provider-archive/lib/data-archive-file'
import { Uuid } from '@cdktf/provider-random/lib/uuid'
import path = require('path')

interface ArtifactFilesContentProps {
    content: string
    filename: string
}
export interface EcsTaskDefinitionInterface {
    taskDefinitionArn: string
    containerDefinitions: ContainerDefinition[]
    family: string
    taskRoleArn: string
    executionRoleArn: string
    networkMode: string
    revision: number
    volumes: any[]
    status: string
    requiresAttributes?: {
        name: string
    }[] // TODO: Find a way to get this
    placementConstraints: {
        type: string
        expression: string
    }[]
    requiresCompatibilities: string[]
    compatibilities: string[]
    cpu?: string
    memory?: string
    tags?: { [key: string]: string }
}

export interface ApplicationECSServiceProps extends TerraformMetaArguments, TerraformMetaArguments {
    serviceName: ThalloService
    environment: Environment
    region?: string // default to eu-west-1
    shortName: string
    tags?: { [key: string]: string }
    ecsClusterArn: string
    ecsClusterName: string
    vpcId: string
    albConfig?: {
        containerPort: number
        containerName: string
        healthCheckPath: string
        albSecurityGroupId: string
        listenerArn: string
    }
    containerConfigs: ApplicationECSContainerDefinitionProps[]
    privateSubnets: string[]
    cpu?: number // default to 512
    memory?: number // default to 1024
    launchType?: 'FARGATE' | 'EC2' // default FARGATE
    deploymentMinimumHealthyPercent?: number
    deploymentMaximumPercent?: number
    desiredCount?: number // default to 2
    lifecycleIgnoreChanges?: string[] // defaults to ['desired_count', load_balancer']
    ecsIamConfig: ApplicationECSIamProps
    useCodeDeploy: boolean // default to true
    useCodePipeline?: boolean
    codeDeployNotifications?: {
        notifyOnStarted?: boolean
        notifyOnSuccess?: boolean
        notifyOnFailed?: boolean
    }
    codeDeploySnsNotificationTopicArn?: string
    efsConfig?: {
        efs: EFSProps
        volumeName: string
    }
    runDbMigration?: boolean
}
export interface EFSProps {
    id: string
    arn: string
    efsConfig?: {
        efs: EFSProps
        volumeName: string
    }
}
export interface EFSProps {
    id: string
    arn: string
}

interface ECSTaskDefinitionResponse {
    taskDef: EcsTaskDefinition
    ecrRepos: EcrRepository[]
}

export class ApplicationECSService extends Construct {
    public readonly service: EcsService
    public readonly taskDefinition: EcsTaskDefinition
    public readonly ecsNetworkConfig: EcsServiceNetworkConfiguration
    public readonly ecrRepos: EcrRepository[]
    public readonly ecsSecurityGroup: SecurityGroup
    public readonly mainTargetGroup?: ApplicationTargetGroup
    public readonly codeDeployApp?: ApplicationECSAlbCodeDeploy
    public readonly ecsArtifactBucket: S3Bucket
    public ecsIam!: ApplicationECSIam //TODO: check this properly
    private readonly config: ApplicationECSServiceProps
    private readonly caller: DataAwsCallerIdentity
    // private readonly artifactFiles: File[]
    private readonly artifactFilesContent: ArtifactFilesContentProps[]

    constructor(scope: Construct, id: string, config: ApplicationECSServiceProps) {
        super(scope, id)

        this.caller = new DataAwsCallerIdentity(this, 'caller', {})

        // set default values on optional properties if not set
        this.config = ApplicationECSService.setDefaultConfigValues(config)
        this.ecsSecurityGroup = this.setECSSecurityGroup()

        // ECS artifact bucket to upload task definition files
        // this.artifactFiles = []
        this.artifactFilesContent = []
        this.ecsArtifactBucket = this.createEcsArtifactBucket({
            environment: this.config.environment,
            serviceName: this.config.serviceName,
        })
        const { taskDef, ecrRepos } = this.setTaskDefinition()

        this.taskDefinition = taskDef
        this.ecrRepos = ecrRepos

        //Setup an array of resources that the ecs service will need to depend on
        const ecsServiceDependsOn: TerraformResource[] = [...ecrRepos]

        this.ecsNetworkConfig = {
            securityGroups: [this.ecsSecurityGroup.id],
            subnets: this.config.privateSubnets,
        }

        const ecsLoadBalancerConfig: EcsServiceLoadBalancer[] = []

        const targetGroupNames: string[] = []

        // If we have a alb configuration lets add it.
        if (config.albConfig) {
            this.mainTargetGroup = this.setTargetGroup('blue')
            ecsServiceDependsOn.push(this.mainTargetGroup.targetGroup)
            // Now that we have our service created, we append the alb listener rule to our HTTPS listener.
            const listenerRule = new AlbListenerRule(this, 'listener_rule', {
                listenerArn: config.albConfig.listenerArn,
                priority: 1,
                condition: [
                    {
                        pathPattern: { values: ['*'] },
                    },
                ],
                action: [
                    {
                        type: 'forward',
                        targetGroupArn: this.mainTargetGroup.targetGroup.arn,
                    },
                ],
                lifecycle: {
                    ignoreChanges: ['action'],
                },
                provider: this.config.provider,
                tags: this.config.tags,
            })
            ecsServiceDependsOn.push(listenerRule)
            targetGroupNames.push(this.mainTargetGroup.targetGroup.name)
            ecsLoadBalancerConfig.push({
                targetGroupArn: this.mainTargetGroup.targetGroup.arn,
                containerName: config.albConfig.containerName,
                containerPort: config.albConfig.containerPort,
            })
        }

        // Create ECS service
        this.service = new EcsService(this, `${this.config.serviceName}_ecs_service`, {
            name: `${this.config.serviceName}`,
            taskDefinition: this.taskDefinition.arn,
            deploymentController: this.config.useCodeDeploy
                ? { type: 'CODE_DEPLOY' }
                : { type: 'ECS' },
            deploymentMinimumHealthyPercent: this.config.deploymentMinimumHealthyPercent,
            deploymentMaximumPercent: this.config.deploymentMaximumPercent,
            desiredCount: this.config.desiredCount,
            cluster: this.config.ecsClusterArn,
            launchType: this.config.launchType,
            loadBalancer: ecsLoadBalancerConfig,
            networkConfiguration: this.ecsNetworkConfig,
            propagateTags: 'SERVICE',
            lifecycle: {
                ignoreChanges: this.config.lifecycleIgnoreChanges,
            },
            dependsOn: ecsServiceDependsOn,
            provider: this.config.provider,
            tags: this.config.tags,
        })

        // Run database migrations if required
        if (config.runDbMigration) {
            const dbMigrationTaskDef = this.setTaskDefinition(
                `${this.config.serviceName}-db-migration`,
                ['npm', 'run', 'migration:run:prod'],
            )
            // Create CodeBuild buildspec file and put it in S3
            this.createBuildSpecFile(dbMigrationTaskDef.taskDef)
        }

        // Setup BLUE/GREEN deployment if ALB is configured
        if (this.config.useCodeDeploy && this.config.albConfig) {
            //Setup a second target group for blue/green deployments
            const greenTargetGroup = this.setTargetGroup(`green`)
            targetGroupNames.push(greenTargetGroup.targetGroup.name)

            // Setup CodeDeploy application
            const codeDeployApp = (this.codeDeployApp = new ApplicationECSAlbCodeDeploy(
                this,
                `ecs_codedeploy_${this.config.serviceName}`,
                {
                    serviceName: this.config.serviceName,
                    clusterName: this.config.ecsClusterName,
                    targetGroupNames: targetGroupNames,
                    listenerArn: this.config.albConfig.listenerArn,
                    snsNotificationTopicArn: this.config.codeDeploySnsNotificationTopicArn,
                    notifications: this.config.codeDeployNotifications,
                    provider: this.config.provider,
                    tags: this.config.tags,
                },
            ))

            if (!this.config.useCodePipeline) {
                //TODO: test this with updated task definition
                /**
                 * If any changes are made to the Task Definition this must be called since we ignore changes to it.
                 *
                 * We typically ignore changes to the following since we rely on BlueGreen Deployments:
                 * ALB Default Action Target Group ARN
                 * ECS Service LoadBalancer Config
                 * ECS Task Definition
                 * ECS Placement Strategy Config
                 */

                const nullECSTaskUpdate = new Resource(
                    this,
                    `null_ecs_task_definition_update_${this.config.serviceName}`,
                    {
                        triggers: { task_arn: taskDef.arn },
                        dependsOn: [
                            taskDef,
                            codeDeployApp.codeDeployApp,
                            codeDeployApp.codeDeployDeploymentGroup,
                        ],
                        provider: this.config.provider,
                    },
                )

                nullECSTaskUpdate.addOverride(
                    'provisioner.local-exec.command',
                    `export app_spec_content_string='{"version":1,"Resources":[{"TargetService":{"Type":"AWS::ECS::Service","Properties":{"TaskDefinition":"${taskDef.arn}","LoadBalancerInfo":{"ContainerName":"${this.config.albConfig.containerName}","ContainerPort":${this.config.albConfig.containerPort}}}}}]}' && export revision="revisionType=AppSpecContent,appSpecContent={content='$app_spec_content_string'}" && aws --region ${this.config.region} deploy create-deployment  --application-name="${codeDeployApp.codeDeployApp.name}"  --deployment-group-name="${codeDeployApp.codeDeployDeploymentGroup.deploymentGroupName}" --description="Triggered from Terraform/CodeBuild due to a task definition update" --revision="$revision" `,
                )
            }
        }

        // Upload taskdef artifact to S3
        this.archiveAndUploadArtifacts(this.artifactFilesContent)
    }

    // Helper function to get a target group
    private setTargetGroup(name: string): ApplicationTargetGroup {
        if (!this.config.albConfig) {
            throw new Error('No albConfig provided')
        }
        return new ApplicationTargetGroup(this, `${name}_target_group`, {
            shortName: truncateString(`${this.config.shortName}${name}`, 6),
            vpcId: this.config.vpcId,
            healthCheckPath: this.config.albConfig.healthCheckPath,
            tags: { ...this.config.tags, type: name },
        })
    }

    // Set default values on optional properties
    private static setDefaultConfigValues(
        config: ApplicationECSServiceProps,
    ): ApplicationECSServiceProps {
        config.region = config.region || 'eu-west-1'
        config.launchType = config.launchType || 'FARGATE'
        config.cpu = config.cpu || 512
        config.memory = config.memory || 1024
        config.deploymentMinimumHealthyPercent = config.deploymentMinimumHealthyPercent || 100
        config.deploymentMaximumPercent = config.deploymentMaximumPercent || 200
        config.desiredCount = config.desiredCount || 2
        config.lifecycleIgnoreChanges = config.lifecycleIgnoreChanges || [
            'load_balancer',
            'desired_count',
            'task_definition',
        ]
        //Need to use ?? because useCodeDeploy can be false
        config.useCodeDeploy = config.useCodeDeploy ?? true
        if (config.useCodeDeploy) {
            // If we are using CodeDeploy we need to ignore changes to the task definition
            config.lifecycleIgnoreChanges.push('task_definition')
            config.lifecycleIgnoreChanges = [...new Set(config.lifecycleIgnoreChanges)]
        }
        //Need to use ?? because useCodeDeploy can be false
        config.useCodeDeploy = config.useCodeDeploy ?? true
        if (config.useCodeDeploy) {
            // If we are using CodeDeploy we need to ignore changes to the task definition
            config.lifecycleIgnoreChanges.push('task_definition')
            config.lifecycleIgnoreChanges = [...new Set(config.lifecycleIgnoreChanges)]
        }
        return config
    }

    private setECSSecurityGroup(): SecurityGroup {
        let ingress: SecurityGroupIngress[] = []
        if (this.config.albConfig) {
            ingress = [
                {
                    fromPort: this.config.albConfig.containerPort,
                    toPort: this.config.albConfig.containerPort,
                    protocol: 'tcp',
                    cidrBlocks: ['0.0.0.0/0'],
                    ipv6CidrBlocks: ['::/0'],
                    prefixListIds: [],
                    securityGroups: [],
                },
            ]
        }
        const egress: SecurityGroupEgress[] = [
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
        ]

        return new SecurityGroup(this, 'ecs_security_group', {
            name: `${this.config.serviceName}-ecs-sg`,
            description: 'Internal ECS Security Group (Managed by Terraform)',
            vpcId: this.config.vpcId,
            ingress,
            egress,
            tags: this.config.tags,
            lifecycle: {
                createBeforeDestroy: true,
            },
        })
    }

    /**
     * Set task definition
     */
    private setTaskDefinition(
        taskDefinitionName?: string,
        containerCommand?: string[],
    ): ECSTaskDefinitionResponse {
        const taskDefName = taskDefinitionName ?? this.config.serviceName
        const ecrRepos: EcrRepository[] = []

        const containerDefs: string[] = []

        // Set unique volumes by volume name
        const volumes: { [key: string]: EcsTaskDefinitionVolume } = {}

        // figure out if we need to create an ECR for each container definition
        // also build a container definition JSON for each container
        this.config.containerConfigs.forEach((def) => {
            if (def.command && containerCommand) {
                def.command = [...def.command, ...containerCommand]
            } else {
                def.command = containerCommand
            }

            // if an image has been given, it must already live somewhere, so an ECR isn't needed
            if (!def.containerImage) {
                const ecrConfig: ApplicationECRProps = {
                    name: `${this.config.serviceName}-${def.name}`.toLowerCase(),
                    tags: this.config.tags,
                    provider: this.config.provider,
                }

                const ecr = new ApplicationECR(this, `ecr-${def.name}`, ecrConfig)

                //Set the image to the latest one for now
                def.containerImage = `${ecr.ecr.repositoryUrl}:latest`

                //The task and service need to depend on the repository existing.
                ecrRepos.push(ecr.ecr)
            }

            // if a log group was given, it must already exist so we don't need to create it
            if (!def.logGroup) {
                const cloudwatchLogGroup = new CloudwatchLogGroup(this, `ecs_${def.name}`, {
                    name: `/ecs/${taskDefName}/${def.name}`,
                    retentionInDays: 30,
                    tags: this.config.tags,
                })
                def.logGroup = cloudwatchLogGroup.name
                def.logGroupRegion = this.config.region
            }
            if (def.mountPoints) {
                def.mountPoints.forEach((mp) => {
                    volumes[mp.sourceVolume] = { name: mp.sourceVolume }
                })
            }

            containerDefs.push(buildDefinitionJSON(def))
        })

        this.ecsIam = new ApplicationECSIam(this, `ecs_iam_${taskDefName}`, {
            prefix: taskDefName,
            taskExecutionDefaultAttachmentArn:
                this.config.ecsIamConfig.taskExecutionDefaultAttachmentArn,
            taskExecutionRolePolicyStatements:
                this.config.ecsIamConfig.taskExecutionRolePolicyStatements,
            taskRolePolicyStatements: this.config.ecsIamConfig.taskRolePolicyStatements,
        })

        // Create task definition
        const taskDef = new EcsTaskDefinition(this, `ecs_task_${taskDefName}`, {
            containerDefinitions: `[${containerDefs}]`,
            family: taskDefName,
            networkMode: 'awsvpc',
            taskRoleArn: this.ecsIam.taskRole.arn,
            executionRoleArn: this.ecsIam.taskExecutionRoleArn,
            requiresCompatibilities: ['FARGATE'],
            cpu: this.config.cpu?.toString(),
            memory: this.config.memory?.toString(),
            volume: Object.values(volumes),
            tags: this.config.tags,
        })

        /**  Create files for CodePipeline
         * taskdef.json
         * imagedefinitions.json
         * appspec.json if ALB is configured
         */

        const taskDefinition: EcsTaskDefinitionInterface = {
            taskDefinitionArn: taskDef.arn,
            containerDefinitions: [JSON.parse(containerDefs[0])],
            family: taskDefName,
            networkMode: 'awsvpc',
            taskRoleArn: this.ecsIam.taskRole.arn,
            executionRoleArn: this.ecsIam.taskExecutionRoleArn,
            requiresCompatibilities: ['FARGATE'],
            status: 'ACTIVE',
            cpu: this.config.cpu?.toString(),
            memory: this.config.memory?.toString(),
            volumes: Object.values(volumes),
            revision: taskDef.revision,
            placementConstraints: [],
            compatibilities: ['EC2', 'FARGATE'],
        }

        this.artifactFilesContent.push({
            content: JSON.stringify(taskDefinition),
            filename: `taskdef_${taskDefName}.json`,
        })

        this.artifactFilesContent.push({
            content: JSON.stringify(
                this.config.containerConfigs.map((def) => {
                    return {
                        name: def.name,
                        imageUri: def.containerImage,
                    }
                }),
            ),
            filename: `imagedef_${taskDefName}.json`,
        })

        // Appspec file for CodeDeploy
        if (this.config.albConfig) {
            this.artifactFilesContent.push({
                content: JSON.stringify({
                    version: 1,
                    Resources: [
                        {
                            TargetService: {
                                Type: 'AWS::ECS::Service',
                                Properties: {
                                    TaskDefinition: taskDef.arn,
                                    LoadBalancerInfo: {
                                        ContainerName: this.config.albConfig.containerName,
                                        ContainerPort: this.config.albConfig.containerPort,
                                    },
                                },
                            },
                        },
                    ],
                }),
                filename: `appspec_${taskDefName}.json`,
            })
        }

        return { taskDef, ecrRepos }
    }

    /**
     *  DB migration setup
     */

    private createBuildSpecFile(taskDefinition: EcsTaskDefinition): void {
        // Set environment variables for the CodeBuild and run-db-migration.sh script
        const codebuildBucket = this.createCodebuildBucket()

        const buildSpec = {
            version: '0.2',
            phases: {
                build: {
                    commands: [
                        `cluster_name=${this.config.ecsClusterName}`,
                        `task_definition=${taskDefinition.arn}`,
                        `region=${this.config.region}`,
                        `network_config="awsvpcConfiguration={subnets=[${Fn.join(
                            ',',
                            this.ecsNetworkConfig.subnets,
                        )}],securityGroups=[${Fn.join(
                            ',',
                            this.ecsNetworkConfig.securityGroups ?? [],
                        )}]}"`,
                        `aws s3 cp "s3://${codebuildBucket.id}/run-db-migration.sh" "run-db-migration.sh"`,
                        `ls -la`,
                        `chmod +x run-db-migration.sh`,
                        `./run-db-migration.sh $(echo "$cluster_name $task_definition $region $network_config")`,
                    ],
                },
            },
        }

        const buildSpecYaml = stringify(buildSpec)

        // Upload the run-db-migration.sh script to the S3 bucket
        new S3Object(this, 'buildspec_db_migration_script', {
            bucket: codebuildBucket.id,
            key: `run-db-migration.sh`,
            source: path.resolve(__dirname, '../../../config/scripts/run-db-migration.sh'),
        })

        new S3Object(this, 'buildspec_db_migration_object', {
            bucket: codebuildBucket.id,
            key: `buildspec_db_migration.yml`,
            content: buildSpecYaml,
        })
    }

    private createCodebuildBucket(): S3Bucket {
        const bucket = new S3Bucket(this, 'codebuild_s3_bucket', {
            bucket: `codebuild.${this.config.serviceName}.${this.config.environment}-${this.caller.accountId}`,
            tags: this.config.tags,
        })

        new S3BucketVersioningA(this, 'codebuild_bucket_versioning', {
            bucket: bucket.id,
            versioningConfiguration: { status: 'Enabled' },
        })

        new S3BucketPublicAccessBlock(this, 'codebuild_bucket_public_access_block', {
            bucket: bucket.id,
            blockPublicAcls: true,
            blockPublicPolicy: true,
            ignorePublicAcls: true,
            restrictPublicBuckets: true,
        })

        return bucket
    }

    private createEcsArtifactBucket(props: {
        environment: Environment
        serviceName: ThalloService
    }): S3Bucket {
        const bucket = new S3Bucket(
            this,
            `ecs_artifact_bucket_${props.serviceName}_${props.environment}`,
            {
                bucket: `ecs-artifacts.${props.serviceName}.${props.environment}-${this.caller.accountId}`,
                forceDestroy: true,
                tags: this.config.tags,
            },
        )

        new S3BucketVersioningA(
            this,
            `ecs_artifact_bucket_versioning_${props.serviceName}_${props.environment}`,
            {
                bucket: bucket.id,
                versioningConfiguration: { status: 'Enabled' },
            },
        )

        new S3BucketPublicAccessBlock(
            this,
            `ecs_artifact_bucket_public_access_block_${props.serviceName}_${props.environment}`,
            {
                bucket: bucket.id,
                blockPublicAcls: true,
                blockPublicPolicy: true,
                ignorePublicAcls: true,
                restrictPublicBuckets: true,
            },
        )

        return bucket
    }

    private archiveAndUploadArtifacts(files: ArtifactFilesContentProps[]): void {
        const archiveSource = files.map((file) => {
            console.log('file', file.content)
            return {
                content: file.content,
                filename: file.filename,
            }
        })

        const randomUuid = new Uuid(this, 'random_uuid', {})

        const archivedFile = new DataArchiveFile(this, `taskdef_archive`, {
            source: archiveSource,
            outputPath: `taskdef.zip`,
            type: 'zip',
            dependsOn: [randomUuid],
        })

        new S3Object(this, `taskdef_archive_s3`, {
            bucket: this.ecsArtifactBucket.id,
            source: archivedFile.outputPath,
            key: `taskdef.zip`,
            etag: randomUuid.result,
            dependsOn: [archivedFile],
        })
    }
}
