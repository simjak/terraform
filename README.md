# Repository Structure

```
├── config      # CodeBuild configuration files and scripts + build version
│   ├── buildspec
│   └── scripts
├── envs        # Terraform specific ENVs service/environment e.g. TF_REPO_BRANCH, IMAGE_TAG, DOMAIN_PREFIX, NODE_ENV
│   ├── bridge-be       
│   ├── exchange-be
│   ├── exchange-fe
│   └── shared
└── src
    ├── constructs
    │   ├── base        # Contains abstractions of AWS services, e.g. an ECS or an SQS Queue
    │   └── thallo      # Contains higher level abstractions that are specific to Thallo's infrastructure, e.g. an ALB-backed application 
    ├── ou
    │   ├── infrastructure
    │   │   └── shared-services     # Contains shared resource in shared services account
    │   │       └── stacks
    │   │           ├── codepipeline
    │   │           ├── ecr
    │   │           ├── iam
    │   │           ├── ses
    │   │           └── sns
    │   ├── management
    │   │   └── control-tower
    │   └── workloads       # Contains application specific infrastructure for dedicated accounts
    │       ├── bridge-be
    │       │   ├── components      # Application specific components VPC, Secrets, Bastion, Buckets, RDS, SNS, SQS
    │       │   └── envs            # Application specific ENVs per environment e.g. demo.env, staging.env
    │       ├── exchange-be
    │       │   ├── components
    │       │   └── envs
    │       └── exchange-fe
```


## AWS Organizational structure

<img width="978" alt="image" src="https://user-images.githubusercontent.com/20096648/225576279-0422e9c6-052c-4974-a542-08779d2549fe.png">

Reference: [Best practices for setting up your multi-account AWS environment](https://aws.amazon.com/organizations/getting-started/best-practices/?orgs_product_gs_bp)

### Current bridge-be single account setup

<img width="1115" alt="image" src="https://user-images.githubusercontent.com/20096648/225551710-9feecad6-2c2b-4d72-a7fd-1c5b4579a3b6.png">

### Current multi-account setup

<img width="1618" alt="image" src="https://user-images.githubusercontent.com/20096648/225550890-c827d103-9aef-472c-86ca-4390a207f52d.png">

Reference: [Multi-Region Terraform Deployments with AWS CodePipeline using Terraform Built CI/CD](https://aws.amazon.com/blogs/devops/multi-region-terraform-deployments-with-aws-codepipeline-using-terraform-built-ci-cd/)

## Terraform deployment workflow
#### Multi-accout

- checkout `beta` branch
- edit code
- View plan using function `deploy_cdk <service_name> <environment> <component>` e.g.  ```deploy_cdk exchange-be demo exchange-ecs```
NOTE: do not apply!

```
NOTE: check the PATH to Terraform repo

function deploy_cdk {
  cat ~/thallo/terraform/envs/$1/$2.env
  export $(cat ~/thallo/terraform/envs/$1/$2.env | xargs)
  aws:shared && twd && cd src/ou/workloads/$1
  rm -rf cdktf.out && cdktf deploy $3
}
```

- Commit changes
- Git tag commit using script ```.~/thallo/terraform/config/scripts/git-tag-new-version.sh --service <enviroment>/<service_name>```
e.g. usage with alias:

```
git:tag:demo:exchange-fe

alias git:tag:demo:exchange-fe="~/thallo/terraform/config/scripts/git-tag-new-version.sh --service demo/exchange-fe"
alias git:tag:demo:exchange-be="~/thallo/terraform/config/scripts/git-tag-new-version.sh --service demo/exchange-be"
```

The Codepiline will be triggered in `shared-services` account and deploys infrastructure based on git tag data.
