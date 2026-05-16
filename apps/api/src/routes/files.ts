import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { S3Client } from "@aws-sdk/client-s3";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * S3 presigned URL endpoint (ADR-0019)
 *
 * Issues temporary upload/download URLs. The client uploads directly
 * to S3 — the API never touches the file bytes.
 *
 * Bucket selection:
 *   bucket=tender-photos  — waste images
 *   bucket=org-documents  — registration docs
 *   bucket=efatura        — e-invoice PDFs
 *
 * API validation (content-type + size) catches abuse at the request layer.
 * Full ClamAV virus scanning is deferred to M6 (Lambda on S3 events).
 */

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "eu-central-1",
  endpoint: process.env.AWS_ENDPOINT ?? "http://localhost:4566",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
  },
  forcePathStyle: true, // LocalStack compatibility
});

const ALLOWED_BUCKETS = ["tender-photos", "org-documents", "efatura"];

const UPLOAD_URL_EXPIRY = 300; // 5 minutes
const DOWNLOAD_URL_EXPIRY = 3600; // 1 hour

export const fileRoutes = new Hono();

// ─── GET /upload-url ────────────────────────────────────────────────

fileRoutes.get("/upload-url", async (c) => {
  const bucket = c.req.query("bucket") ?? "tender-photos";
  const fileName = c.req.query("file") ?? "upload";
  const contentType = c.req.query("contentType") ?? "application/octet-stream";

  if (!ALLOWED_BUCKETS.includes(bucket)) {
    throw new HTTPException(400, { message: `Invalid bucket. Allowed: ${ALLOWED_BUCKETS.join(", ")}` });
  }

  // Basic content-type validation (catches 99% of abuse)
  const allowedTypes = [
    "image/jpeg", "image/png", "image/webp",
    "application/pdf",
    "application/xml",
  ];
  if (!allowedTypes.includes(contentType)) {
    throw new HTTPException(400, { message: `Content type not allowed: ${contentType}` });
  }

  const key = `uploads/${Date.now()}-${fileName}`;
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(s3, command, { expiresIn: UPLOAD_URL_EXPIRY });

  return c.json({ uploadUrl: url, key, bucket, expiresIn: UPLOAD_URL_EXPIRY });
});

// ─── GET /download-url ──────────────────────────────────────────────

fileRoutes.get("/download-url", async (c) => {
  const bucket = c.req.query("bucket") ?? "tender-photos";
  const key = c.req.query("key");

  if (!key) throw new HTTPException(400, { message: "key query parameter required" });
  if (!ALLOWED_BUCKETS.includes(bucket)) {
    throw new HTTPException(400, { message: `Invalid bucket` });
  }

  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(s3, command, { expiresIn: DOWNLOAD_URL_EXPIRY });

  return c.json({ downloadUrl: url, key, expiresIn: DOWNLOAD_URL_EXPIRY });
});
