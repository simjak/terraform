#!/bin/bash

# Parse command-line arguments
while [[ $# -gt 0 ]]
do
key="$1"

case $key in
    -s|--service)
    SERVICE="$2"
    shift # past argument
    shift # past value
    ;;
    *)    # unknown option
    echo "Unknown option: $1"
    exit 1
    ;;
esac
done

# Set default values if not provided by the user
SERVICE=${SERVICE:-default}
VERSION_FILE="config/.version"

# Check out the current version
echo "Checking out version..."
if [ ! -f "$VERSION_FILE" ]; then echo "1.0.0" > "$VERSION_FILE"; fi
current_version=$(cat "$VERSION_FILE")
new_version=$(semver bump patch "$current_version") && echo "$new_version" > "$VERSION_FILE"
echo "version" $(cat "$VERSION_FILE")

# Commit and tag changes
commit_message="Bump the version for $SERVICE to $new_version"
tag_name="tags/$SERVICE/$new_version"
echo "Committing changes with message: $commit_message and tag: $tag_name"
git add $VERSION_FILE && git commit -m "$commit_message" && git tag "$tag_name" && git push -u origin $(git rev-parse --abbrev-ref HEAD) --tags