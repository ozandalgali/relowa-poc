/**
 * files.test.ts — S3 presigned URL endpoints
 */
import { describe, it, expect } from "vitest";
import { SEED, authHeader, api } from "./helpers";

describe("File upload/download URLs", () => {
  it("generates upload URL (200)", async () => {
    const res = await api(
      "/files/upload-url?bucket=tender-photos&file=test.jpg&contentType=image/jpeg",
      {
        headers: await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).toBeTruthy();
    expect(body.key).toContain("uploads/");
    expect(body.bucket).toBe("tender-photos");
  });

  it("returns 401 without auth", async () => {
    const res = await api("/files/upload-url?bucket=tender-photos&file=test.jpg&contentType=image/jpeg");
    expect(res.status).toBe(401);
  });

  it("rejects invalid bucket (400)", async () => {
    const res = await api(
      "/files/upload-url?bucket=unknown-bucket&file=test.jpg&contentType=image/jpeg",
      {
        headers: await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid content type (400)", async () => {
    const res = await api(
      "/files/upload-url?bucket=tender-photos&file=test.exe&contentType=application/x-msdownload",
      {
        headers: await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects download without key (400)", async () => {
    const res = await api("/files/download-url?bucket=tender-photos", {
      headers: await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
    });
    expect(res.status).toBe(400);
  });
});
