# Temporary storage and room recovery

DropSync keeps room state and activity in MongoDB. Redis carries presence, rate limits, expiry notifications, and Socket.IO fan-out. Files live in a private Amazon S3 Standard bucket. Browser uploads and downloads use five-minute signed URLs, so file bytes do not pass through Express. Meetings remain independent.

**Card-free trial limit:** AWS says most new customers can create a Free Plan account without a payment method, but may request one for identity verification. S3 is included. The Free Plan ends after six months or when credits run out; AWS then closes the account and access to resources unless you upgrade. Existing AWS customers may not qualify. Do not treat this as permanent storage or a promise of unlimited free use. See [AWS Free Tier FAQ](https://aws.amazon.com/free/free-tier-faqs/), [supported services](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html), and [plan behavior](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).

## Limits and lifecycle

- Creator-selected room lifetime: 5–1440 minutes; default 5 minutes.
- Recovery: 24 hours after each expiry. Existing participants can read and download using the token saved in their browser. Only the creator's recovery key can reopen or request early deletion.
- Reopening starts a fresh active period of the original duration and a new 24-hour recovery window.
- Files: 500 MiB each; 2 GiB retained plus reserved per room; 8 GiB retained plus reserved across the app.
- At the exact expiry or recovery deadline, API and socket authorization stops the corresponding actions. GitHub Actions calls the cleanup API hourly; physical deletion follows on the next successful run. Existing signed URLs can work for up to five minutes.
- MongoDB transactions require a replica set, including in local development and CI.

## Operator setup

1. Create an AWS account using the **Free Plan**, if eligible, and verify that S3 is available in your project. If AWS requests a payment method and you cannot provide one, stop here; this deployment path cannot be completed for that account.
2. Create a **general purpose S3 Standard** bucket in the AWS Region assigned to your project. Keep **Block all public access** enabled. Leave versioning and Object Lock disabled so cleanup physically removes objects. The account's default SSE-S3 encryption is sufficient; avoid a customer-managed KMS key unless you also configure its permissions.
3. Create an IAM user for programmatic access only, with an access key and the bucket-scoped policy below. Use the bucket's exact Region as `AWS_REGION`; enter its name as `AWS_S3_BUCKET`, the key ID as `AWS_ACCESS_KEY_ID`, and the secret as `AWS_SECRET_ACCESS_KEY` in Render. Never use root-account access keys. If AWS issued temporary credentials, also set `AWS_SESSION_TOKEN` in Render before they expire.
4. In the bucket's **Permissions → CORS**, allow the exact deployed Vercel origin and `http://localhost:5173` for local testing, `GET`/`PUT`/`HEAD`, and expose `ETag`. In **Management → Lifecycle rules**, abort incomplete multipart uploads after one day.
5. Set `CLEANUP_SECRET` in Render to a long random value. Deploy the API, then the client with `VITE_API_URL` pointing at the API origin. In GitHub repository **Settings → Secrets and variables → Actions**, add `CLEANUP_URL=https://YOUR-API/internal/cleanup` and `CLEANUP_SECRET` with that same value. Run the **Room cleanup** workflow manually once; its hourly schedule is `17 * * * *` UTC.
6. Check S3 storage and request usage, AWS Free Plan credits and remaining days, GitHub Actions workflow failures, Render logs, and MongoDB room records with `status: deleting`. The 8 GiB app cap is an application reservation limit and can exceed S3's individual free storage allowance; AWS credits and account status must be monitored.

Use a MongoDB Atlas replica set or local MongoDB started with `--replSet rs0`. The existing `server/.env.example` shows local variables. Keep keys in environment secrets, not Git or client assets.

Example IAM policy (replace `YOUR_BUCKET` with the exact bucket name) for the Render API's programmatic IAM user:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "s3:PutObject", "s3:GetObject", "s3:DeleteObject",
      "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"
    ],
    "Resource": "arn:aws:s3:::YOUR_BUCKET/rooms/*"
  }]
}
```

The API generates random keys below `rooms/`. It does not need public bucket access or permission to create buckets. [AWS multipart permission reference](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html).

Example S3 bucket CORS rule (replace the Vercel host with your exact origin):

```json
[
  {
    "AllowedOrigins": ["https://YOUR-APP.vercel.app", "http://localhost:5173"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

S3 requires the same CORS methods and exposed ETag for browser multipart uploads. See [S3 CORS configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html) and [incomplete-upload lifecycle rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html). GitHub scheduled runs may be delayed or dropped; public repositories also have scheduled workflows disabled after 60 days without activity. The application enforces access deadlines itself, while physical deletion waits for a successful workflow run. Run **Room cleanup** manually if scheduling stops. See [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Room API

All private endpoints require `Authorization: Bearer <accessToken>`. A room code alone is not a member credential. Tokens are randomly generated and only their SHA-256 hashes are stored by the server.

| Method and route | Behavior |
|---|---|
| `POST /api/rooms` | Accepts `{ durationMinutes, name?, password? }`; returns room, participant ID, access token, and one-time recovery key. |
| `GET /api/rooms/:code/preview` | Public code, state, and password requirement; no activity or files. |
| `POST /api/rooms/:code/join` | Accepts active-room join details; returns room, participant ID, and access token. |
| `GET /api/rooms/:code` | Returns private room state to a current or prior participant while active or recoverable. |
| `POST /api/rooms/:code/reopen` | Requires `{ recoveryKey }` before the recovery deadline; returns a fresh owner access token. |
| `DELETE /api/rooms/:code` | Requires `{ recoveryKey }`; blocks access immediately and queues cleanup. |
| `POST /api/rooms/:code/files` | Validates file details and atomically reserves capacity; returns file ID, part size, and part count. |
| `POST /api/rooms/:code/files/:fileId/parts/:partNumber/url` | Returns a five-minute signed multipart part URL to the upload owner. |
| `GET /api/rooms/:code/files/:fileId/upload-status` | Returns stored part numbers and ETags for resume. |
| `POST /api/rooms/:code/files/:fileId/complete` | Verifies parts, completes the object, verifies final size, and publishes the file activity. |
| `POST /api/rooms/:code/files/:fileId/abort` | Aborts an incomplete upload and releases its reservation. |
| `GET /api/rooms/:code/files` | Lists completed files for active or recoverable members. |
| `GET /api/rooms/:code/files/:fileId/download-url` | Returns a five-minute signed download URL for active or recoverable members. |

Only active rooms accept joins, activity, or upload operations. The client stores member tokens locally so prior participants can return from the same browser. The creator should copy the recovery key before leaving that browser.

## Release and verification

Deploy the API before the client. Existing Redis fallback downloads remain available for their previous short lifetime, but new uploads use the private multipart flow. Verify in two browsers: create and join, upload a large file, interrupt and reselect the same file to resume, download as each member, expire, read during recovery, reopen with the key, then delete and inspect the next cleanup run. The automated tests mock storage operations; a real S3 test requires your bucket credentials and CORS configuration.

Official references: [AWS Free Plan](https://aws.amazon.com/free/free-tier-faqs/), [S3 multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html), [S3 CORS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html), [S3 lifecycle rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html), [GitHub Actions schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
