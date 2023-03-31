#!/bin/bash

function run_task {
  echo "Running ECS task..."
  local cluster_name=$1
  local task_definition=$2
  local region=$3
  local network_config=$4

  if [ -z "$cluster_name" ] || [ -z "$task_definition" ] || [ -z "$region" ] || [ -z "$network_config" ]; then
    echo "Error: One or more input parameters are missing."
    return 1
  fi

  run_result=$(aws --region "$region" ecs run-task --launch-type FARGATE --cluster "$cluster_name" --task-definition "$task_definition" --network-configuration "$network_config")
  if [ $? -ne 0 ]; then
    echo "Error: Failed to run the ECS task."
    return 1
  fi
  echo "Task has been started."

  container_arn=$(echo $run_result | jq '.tasks[0].taskArn' | sed -e 's/^"//' -e 's/"$//')
  echo "Task ARN: $container_arn"

  echo "Waiting for task to stop..."
  aws --region "$region" ecs wait tasks-stopped --cluster "$cluster_name" --tasks "$container_arn"
  if [ $? -ne 0 ]; then
    echo "Error: Failed to wait for the task to stop."
    return 1
  fi
  echo "Task has stopped."

  echo "Getting task details..."
  describe_result=$(aws --region "$region" ecs describe-tasks --cluster "$cluster_name" --tasks "$container_arn")
  if [ $? -ne 0 ]; then
    echo "Error: Failed to get task details."
    return 1
  fi
  echo "Task details: $describe_result"

  container_exit_code=$(echo $describe_result | jq '.tasks[0].containers[0].exitCode')
  echo "Task exit code: $container_exit_code"
  stopped_reason=$(echo $describe_result | jq '.tasks[0].stoppedReason')
  echo "Task stopped reason: $stopped_reason"

  return $container_exit_code
}

if [ $# -ne 4 ]; then
  echo "Error: Invalid number of arguments. Expecting 4 arguments: cluster_name, task_definition, region, network_config."
  exit 1
fi

cluster_name=$1
task_definition=$2
region=$3
network_config=$4

run_task "$cluster_name" "$task_definition" "$region" "$network_config"
exit_status=$?
echo "Script exit status: $exit_status"
exit $exit_status
