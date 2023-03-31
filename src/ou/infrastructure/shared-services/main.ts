import { SharedIamStack } from './stacks/iam/SharedIamStack'
import { SharedCodePipelineStack } from './stacks/codepipeline/SharedCodePipelineStack'
import { App } from 'cdktf'
import { SharedEcrStack } from './stacks/ecr/SharedEcrStack'
import { SharedSnsStack } from './stacks/sns/SharedSnsStack'
import { SharedSesStack } from './stacks/ses/SharedSesStack'

const app = new App()
new SharedSesStack(app, 'shared-ses')
// new SharedBucketsStack(app, 'shared-buckets')
// new SharedDnsStack(app, 'shared-dns')
// new SharedCodepipelineCdkImage(app, 'shared-codepipeline-cdk-image')
new SharedSnsStack(app, 'shared-sns')
new SharedEcrStack(app, 'shared-ecr')
new SharedCodePipelineStack(app, 'shared-codepipeline')
new SharedIamStack(app, 'shared-iam')
app.synth()
