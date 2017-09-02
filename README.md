# lambda-feed-alerts

A simple hack to get email alerts for new feed items from an AWS Lambda function.

Usage:
- Testing locally: `lambda-local -l klein.js -e sample-event.js -t 30`.
- Packaging for upload to Lambda: `zip -r foo.zip config.json klein.js node_modules/ package.json`.
- Environment variables needed on Lambda: `RUNNING_ON_LAMBDA` set to `1`.

Config file format:
```
{
  "region": "us-west-2",
  // AWS user credentials, only used for local testing.
  "accessKeyId": "...", 
  "secretAccessKey": "...",
  // The URL of the source feed.
  "adsFeedUrl": "...",
  // The email address to use as the sender with SES.
  "fromEmail": "...", 
  // The destination email addresses.
  "toEmails": [
    "...",
    "..."
  ],
  // The S3 details of where we persist the already seen feed items.
  "seenS3Bucket": "...", // 
  "seenS3Key": "..."
}
```
