import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity'
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document'
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket'
import { S3BucketPolicy } from '@cdktf/provider-aws/lib/s3-bucket-policy'
import { S3BucketServerSideEncryptionConfigurationA } from '@cdktf/provider-aws/lib/s3-bucket-server-side-encryption-configuration'
import { S3BucketVersioningA } from '@cdktf/provider-aws/lib/s3-bucket-versioning'
import { S3BucketWebsiteConfiguration } from '@cdktf/provider-aws/lib/s3-bucket-website-configuration'
import { S3Object } from '@cdktf/provider-aws/lib/s3-object'
import { TerraformAsset } from 'cdktf'
import { Construct } from 'constructs/lib'
import { glob } from 'glob'
import { lookup as mime } from 'mime-types'
import path = require('path')

export interface ApplicationStaticWebsiteBucketProps {
    serviceName: string
    environment: string
    absoluteContentPath?: string
    websiteIndexDocument?: string
    websiteErrorDocument?: string
    tags?: { [key: string]: string }
}

export class ApplicationStaticWebsiteBucket extends Construct {
    public readonly bucket: S3Bucket
    constructor(scope: Construct, name: string, props: ApplicationStaticWebsiteBucketProps) {
        super(scope, name)

        const caller = new DataAwsCallerIdentity(this, 'caller_identity')

        this.bucket = new S3Bucket(this, 's3_bucket', {
            bucket: `static-website.${props.serviceName}.${props.environment}-${caller.accountId}`,
            forceDestroy: true,
            tags: props.tags,
        })

        // Enable website delivery
        new S3BucketWebsiteConfiguration(this, 's3_bucket_website_configuration', {
            bucket: this.bucket.id,
            indexDocument: { suffix: props.websiteIndexDocument || 'index.html' },
            errorDocument: { key: props.websiteErrorDocument || 'error.html' },
        })

        new S3BucketVersioningA(this, 's3_bucket_versioning', {
            bucket: this.bucket.id,
            versioningConfiguration: { status: 'Enabled' },
        })

        new S3BucketServerSideEncryptionConfigurationA(this, 's3_bucket_encryption', {
            bucket: this.bucket.id,
            rule: [
                {
                    applyServerSideEncryptionByDefault: {
                        sseAlgorithm: 'AES256',
                    },
                },
            ],
        })

        // S3 Bucket ACL and Policy
        const websiteBucketPolicy = new DataAwsIamPolicyDocument(this, 'data_s3_bucket_policy', {
            statement: [
                {
                    actions: ['s3:GetObject'],
                    resources: [this.bucket.arn, `${this.bucket.arn}/*`],
                    principals: [
                        {
                            identifiers: ['*'],
                            type: 'AWS',
                        },
                    ],
                },
            ],
        })

        new S3BucketPolicy(this, 's3_bucket_policy', {
            bucket: this.bucket.id,
            policy: websiteBucketPolicy.json,
        })

        // S3 Objects
        new S3Object(this, 's3_index_placeholder_file', {
            bucket: this.bucket.id,
            key: 'index.html',
            content: "It's a placeholder index.html file",
            contentType: 'text/html',
            lifecycle: {
                ignoreChanges: ['etag', 'metadata'],
            },
        })

        new S3Object(this, 's3_error_placeholder_file', {
            bucket: this.bucket.id,
            key: 'error.html',
            content: "It's a placeholder error.html file",
            contentType: 'text/html',
            lifecycle: {
                ignoreChanges: ['etag', 'metadata'],
            },
        })

        if (props.absoluteContentPath) {
            const absoluteContentPath = path.resolve(__dirname, props.absoluteContentPath)
            // // Get built context into the terraform context
            const { path: contentPath, assetHash: contentHash } = new TerraformAsset(
                this,
                `context`,
                {
                    path: absoluteContentPath,
                },
            )
            this.syncFiles(props, absoluteContentPath, contentPath, contentHash)
        }
    }

    private async syncFiles(
        props: ApplicationStaticWebsiteBucketProps,
        absoluteContentPath: string,
        contentPath: string,
        contentHash: string,
    ) {
        // Get all build files synchronously
        const files = await glob('**/*.*', {
            cwd: absoluteContentPath,
        })

        files.forEach((file: string) => {
            // Construct the local path to the file
            const localPath = path.join(contentPath, file)

            //Create all files in the bucket
            new S3Object(this, `${props.serviceName}/${file}/${contentHash}`, {
                bucket: this.bucket.id,
                tags: props.tags,
                key: file,
                source: localPath,
                // mime in an open source library that maps file extensions to mime types
                contentType: mime(path.extname(file)) || 'text/html',
                etag: `filemd5(${localPath})`,
            })
        })
    }
}
