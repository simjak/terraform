#!/bin/bash

# unset previous AWS credentials
unset AWS_PROFILE
unset AWS_SESSION_TOKEN
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
unset TF_RUN_MODE

echo "Unset previous AWS credentials"

# set environment variables
export AWS_PROFILE=shared_services
export TF_RUN_MODE=local

# assume AWS IAM Role
export ROLE_ARN="arn:aws:iam::188857797225:role/terraform-build-role"
export AWS_ASSUMED_PROFILE=terraform-assumed-role
SESSION_NAME=terraform-assume-role-session-$(date +%s)
echo "Assuming role: $ROLE_ARN"

CREDS=$(aws --region eu-west-1 --profile $AWS_PROFILE sts assume-role  --role-arn $ROLE_ARN --role-session-name $SESSION_NAME --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text)

export AWS_ACCESS_KEY_ID=$(echo $CREDS | awk '{print $1}')
export AWS_SECRET_ACCESS_KEY=$(echo $CREDS | awk '{print $2}')
export AWS_SESSION_TOKEN=$(echo $CREDS | awk '{print $3}')

echo "AWS IAM Role assumed successfully"

# set AWS credentials for the assumed role
aws configure set aws_access_key_id "$AWS_ACCESS_KEY_ID" --profile $AWS_ASSUMED_PROFILE
aws configure set aws_secret_access_key "$AWS_SECRET_ACCESS_KEY" --profile $AWS_ASSUMED_PROFILE
aws configure set aws_session_token "$AWS_SESSION_TOKEN" --profile $AWS_ASSUMED_PROFILE
aws configure set region eu-west-1 --profile $AWS_ASSUMED_PROFILE

# test the credentials
# echo "Testing AWS credentials..."
# debug output to verify that the role has been assumed
# echo "Assumed role: $(aws sts get-caller-identity --profile $AWS_ASSUMED_PROFILE --output text --query 'Arn')"