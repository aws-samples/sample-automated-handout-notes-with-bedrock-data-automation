#!/bin/bash

# Check if prefix argument is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <prefix>"
    echo "Example: $0 bda-blog-input"
    exit 1
fi

PREFIX="$1"

# Get a list of all buckets that start with the prefix
BUCKETS=$(aws s3api list-buckets --query "Buckets[?starts_with(Name, '$PREFIX')].Name" --output text)

if [ -z "$BUCKETS" ]; then
  echo "No buckets found with prefix $PREFIX"
  exit 0
fi

for BUCKET in $BUCKETS; do
  echo "Processing bucket: $BUCKET"

  # Empty the bucket (including versions if versioning is enabled)
  aws s3 rm "s3://$BUCKET" --recursive

  # Check if the bucket has versioning enabled and delete all versions if needed
  VERSIONING_STATUS=$(aws s3api get-bucket-versioning --bucket "$BUCKET" --query "Status" --output text)

  if [ "$VERSIONING_STATUS" == "Enabled" ] || [ "$VERSIONING_STATUS" == "Suspended" ]; then
    echo "Deleting all object versions from bucket: $BUCKET"

    # Get all object versions
    VERSIONS=$(aws s3api list-object-versions --bucket "$BUCKET" --query 'Versions[].{Key:Key,VersionId:VersionId}' --output json)
    DELETEMARKERS=$(aws s3api list-object-versions --bucket "$BUCKET" --query 'DeleteMarkers[].{Key:Key,VersionId:VersionId}' --output json)

    # Delete all versions
    echo "$VERSIONS" | jq -c '.[]' | while read -r obj; do
      KEY=$(echo "$obj" | jq -r '.Key')
      VERSION_ID=$(echo "$obj" | jq -r '.VersionId')
      aws s3api delete-object --bucket "$BUCKET" --key "$KEY" --version-id "$VERSION_ID"
    done

    # Delete all delete markers
    echo "$DELETEMARKERS" | jq -c '.[]' | while read -r obj; do
      KEY=$(echo "$obj" | jq -r '.Key')
      VERSION_ID=$(echo "$obj" | jq -r '.VersionId')
      aws s3api delete-object --bucket "$BUCKET" --key "$KEY" --version-id "$VERSION_ID"
    done
  fi

done

echo "All matching buckets have been emptied"
