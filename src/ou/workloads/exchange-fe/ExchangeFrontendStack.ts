import { ThalloStaticApplicationConfig } from './../../../constructs/thallo/ThalloStaticApplication'
import { Codepipeline } from '@cdktf/provider-aws/lib/codepipeline'
import { AwsProvider } from '@cdktf/provider-aws/lib/provider'
import { NullProvider } from '@cdktf/provider-null/lib/provider'
import { S3Backend } from 'cdktf'
import { TerraformStack } from 'cdktf/lib/terraform-stack'
import { Construct } from 'constructs/lib'
import { ThalloStaticApplication } from '../../../constructs/thallo/ThalloStaticApplication'
import { ThalloStaticCodePipeline } from '../../../constructs/thallo/ThalloStaticCodePipeline'
import {
    DeploymentMode,
    Environment,
    ThalloProduct,
    ThalloService,
} from '../../../constructs/thallo/ThalloApplicationConfig'
import { DataAwsCodestarconnectionsConnection } from '@cdktf/provider-aws/lib/data-aws-codestarconnections-connection'

export class ExchangeFrontendStack extends TerraformStack {
    private config: ThalloStaticApplicationConfig
    constructor(scope: Construct, id: string) {
        super(scope, id)

        const currentDeploymentMode: DeploymentMode = process.env.TF_RUN_MODE as DeploymentMode
        const isLocal = currentDeploymentMode === DeploymentMode.LOCAL
        const currentEnvironment: Environment = process.env.NODE_ENV as Environment

        this.config = ThalloStaticApplication.createStaticAppConfig({
            productName: ThalloProduct.EXCHANGE,
            serviceName: ThalloService.EXCHANGE_FE,
            domainPrefix: process.env.DOMAIN_PREFIX || 'market',
            deploymentMode: currentDeploymentMode,
            environment: currentEnvironment,
            aws: {
                profile: isLocal ? process.env.AWS_PROFILE : undefined,
            },
            codePipeline: {
                gitRepositoryName: 'thallo-io/exchange-fe',
                gitRepositoryBranch: process.env.APP_BRANCH || 'main',
                githubConnectionName: 'aws-terraform-github',
            },
            tags: {
                service: ThalloService.EXCHANGE_FE,
                environment: currentEnvironment,
            },
        })

        console.log('this.config', this.config)

        new AwsProvider(this, 'aws', {
            profile: this.config.aws.profile,
            region: this.config.aws.region,
            assumeRole: [
                {
                    roleArn: `arn:aws:iam::${this.config.aws.account.target}:role/terraform-build-role`,
                },
            ],
        })

        new S3Backend(this, {
            // Terraform state buckets are in the shared services account
            roleArn: `arn:aws:iam::${this.config.aws.account.sharedServices}:role/terraform-build-role`,
            bucket: `tf-state.${this.config.serviceName}.${this.config.environment}-${this.config.aws.account.target}`,
            key: `tf-state/${this.config.serviceName}-${this.config.aws.account.target}-ecs.json`,
            region: this.config.aws.region,
        })

        new NullProvider(this, 'null', {})

        const staticApplication = this.createApplication()

        const snsNotificationTopics = ThalloStaticApplication.getApplicationSnsTopics(
            this,
            this.config,
        )

        this.createCodePipeline(staticApplication, snsNotificationTopics.deploymentSns.arn)
    }

    /*
    Connect to Github
    */
    private getGithubConnectionArn(connectionName: string): string {
        return new DataAwsCodestarconnectionsConnection(this, 'github-connection', {
            name: connectionName,
        }).arn
    }

    private createApplication(): ThalloStaticApplication {
        return new ThalloStaticApplication(this, 'exchange-frontend', this.config)
    }

    private createCodePipeline(
        app: ThalloStaticApplication,
        snsNotificationTopicArn: string,
    ): Codepipeline {
        return new ThalloStaticCodePipeline(this, 'exchange-frontend-codepipeline', {
            serviceName: this.config.serviceName,
            environment: this.config.environment,
            artifactBucketPrefix: this.config.serviceName,
            source: {
                websiteBucket: app.websiteBucket,
                gitRepositoryName: this.config.codePipeline.gitRepositoryName,
                branchName: this.config.codePipeline.gitRepositoryBranch,
                codeStarConnectionArn: this.getGithubConnectionArn(
                    this.config.codePipeline.githubConnectionName,
                ),
            },
            codebuild: {
                image: this.config.codePipeline.codeBuild.image,
            },
            snsNotificationTopicArn: snsNotificationTopicArn,
            tags: this.config.tags,
        }).codePipeline
    }
}
