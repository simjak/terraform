#!/bin/bash

# AWS
alias awr="aws --region eu-west-1"

#Usage aws:shared; aws:demo:exchange; aws:staging:exchange
alias aws:shared="source terraform/config/scripts/assume_role_shared.sh"
alias aws:demo:exchange="aws:shared && source terraform/config/scripts/assume_role_target.sh 055688320567"
alias aws:staging:exchange="aws:shared && source terraform/config/scripts/assume_role_target.sh 960508820510"

# git tag
#Usage git:tag:staging:exchange-be; git:tag:demo:exchange-be
alias git:tag:staging:exchange-be="terraform/config/scripts/git-tag-new-version.sh --service staging/exchange-be"
alias git:tag:demo:exchange-be="terraform/config/scripts/git-tag-new-version.sh --service demo/exchange-be"
alias git:tag:staging:exchange-fe="terraform/config/scripts/git-tag-new-version.sh --service staging/exchange-fe"
alias git:tag:demo:exchange-fe="terraform/config/scripts/git-tag-new-version.sh --service demo/exchange-fe"

# terraform deployment scripts
# Usage: deploy_cdk exchange-be staging exchange-ecs

function deploy_cdk {
  cat terraform/envs/$1/$2.env
  export $(cat terraform/envs/$1/$2.env | xargs)
  echo "Image tag: $IMAGE_TAG, Domain prefix: $DOMAIN_PREFIX"
  aws:shared && twd && cd src/ou/workloads/$1
  rm -rf cdktf.out && cdktf deploy $3
}

function destroy_cdk {
  cat terraform/envs/$1/$2.env
  export $(cat terraform/envs/$1/$2.env | xargs)
  echo "Image tag: $IMAGE_TAG, Domain prefix: $DOMAIN_PREFIX"
  aws:shared && twd && cd src/ou/workloads/$1
  rm -rf cdktf.out && cdktf destroy $3
}



