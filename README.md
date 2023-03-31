# Wishlist

- Bugdet alert module (Overwall billing module, options enable cost allocation tags)
- IAM management in IAM center

# Commands

- Deploy new bridge-be version `BRIDGE_IMAGE_TAG={IMAGE_TAG} npm run deploy:bridge:ecs:test`

# Naming conventions

- Buckets
```{aws_service/bucket_prefix}.{service_name}.{environment}-{account_id}```

# Base 64 encode/decode string

TO do this locally, you can run the following:

- `npm run base64Encode -- plainText=PLAIN_TEXT`
- or to load from a file: `npm run base64Encode -- file=secrets/testFireblocksKeyEncrypted.txt`

## decode

- `npm run base64Encode -- plainText=PLAIN_TEXT encodeMode=decode`
- or to load from a file: `npm run base64Encode -- file=PlainText.txt encodeMode=decode`

It will output the hash to your console

# KMS

## Encrypt

```bash
aws kms encrypt \
    --region eu-west-1 \
    --key-id alias/fireblocks_sym \
    --plaintext fileb://secrets/testFireblocksKey.txt \
    --output text \
    --query CiphertextBlob | base64 \
    --decode > secrets/testFireblocksKeyEncrypted.txt
```

# Manual steps after deploying application

- KMS key
- ChatBot
