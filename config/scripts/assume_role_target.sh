#!/bin/bash

# unset previous AWS credentials
unset AWS_SESSION_TOKEN
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
unset TF_RUN_MODE

# set target AWS account
TARGET_ACCOUNT=$1
if [[ -z "$TARGET_ACCOUNT" ]]; then
  echo "Error: Target AWS account not provided."
  echo "Usage: ./assume_role_target.sh <TARGET_ACCOUNT>"
  exit 1
fi

echo "Assuming role in account: $TARGET_ACCOUNT"

# assume AWS IAM Role
ROLE_ARN="arn:aws:iam::${TARGET_ACCOUNT}:role/terraform-build-role"
SESSION_NAME="terraform-assume-role-session-$(date +%s)"
CREDS=$(aws --region eu-west-1 sts assume-role --role-arn "$ROLE_ARN" --role-session-name "$SESSION_NAME" --query 'Credentials.[AccessKeyId, SecretAccessKey, SessionToken]' --output text)

export AWS_ACCESS_KEY_ID=$(echo "$CREDS" | cut -f1)
export AWS_SECRET_ACCESS_KEY=$(echo "$CREDS" | cut -f2)
export AWS_SESSION_TOKEN=$(echo "$CREDS" | cut -f3)

echo "AWS IAM Role assumed successfully"
# echo "Assumed role: $(aws sts get-caller-identity  --output text --query 'Arn')"
