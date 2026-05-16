# M4 Plan — Escrow + Providers + S3 + ESG

> **Agent:** endpoint-writer, state-machine-author, ci-cd-engineer, tester, doc-keeper
> **Squad:** API & Workflow per ADR-0016
> **Target:** Weeks 14-16 per PRD-0003

## Status

| # | Sprint | Status |
|---|--------|--------|
| 1-8 | M4a — Escrow Core + S3 buckets | ✅ Done |
| 9-15 | M4b — Lambdas + Step Functions + ESG | ✅ Pending |

## M4a — Escrow Core + S3 buckets

| # | What | Where | Status |
|---|------|-------|--------|
| 1 | `EscrowProvider` interface | `apps/api/src/providers/interface.ts` | ✅ |
| 2 | `ManualProvider` implementation | `apps/api/src/providers/manual.ts` | ✅ |
| 3 | IBAN hashing utility (KVKK) | `apps/api/src/utils/iban.ts` | ✅ |
| 4 | `POST /escrow` — create + start escrow | `apps/api/src/routes/escrow.ts` | ✅ |
| 5 | `GET /escrow/:id` — escrow status | Same file | ✅ |
| 6 | `POST /api/webhooks/:provider` — idempotent webhook | `apps/api/src/routes/webhooks.ts` | ✅ |
| 7 | S3 Terraform — 5 buckets + Object Lock | `infra/s3.tf` | ✅ |
| 8 | `GET /upload-url` — presigned S3 URL | `apps/api/src/routes/files.ts` | ✅ |

## M4b — Real AWS: Lambdas + Step Functions + ESG

| # | What | Where | Status |
|---|------|-------|--------|
| 9 | 5 escrow Lambdas (create, release, refund...) | `apps/lambdas/escrow/` | ✅ |
| 10 | Step Functions ASL definition | `apps/lambdas/escrow/state-machine.asl.json` | ✅ |
| 11 | Step Functions Terraform (SFN + IAM roles) | `infra/sfn.tf` | ✅ |
| 12 | SQS queue Terraform (webhook processing) | `infra/sqs.tf` | ✅ |
| 13 | ESG cert Lambda on escrow RELEASED | In release chain | ✅ |
| 14 | Daily audit export Lambda → S3 WORM | `apps/lambdas/audit-export/` | ⬜ |
| 15 | `tests/escrow-flow.sh` — end-to-end | `tests/` | ⬜ |

## Deferred

| Item | Sprint | Why |
|------|--------|-----|
| IyzicoProvider | M4+ | Needs Iyzico sandbox account + API keys |
| Nilvera/Foriba e-fatura | M4+ | Needs provider sandbox |
| ClamAV virus scanner | M6 | API validation (content-type, size) sufficient for 50-100 POC users. Full AV scan on S3 events when real users upload files |

## Manual steps

| # | When | Action |
|---|------|--------|
| 1 | After M4a S3 Terraform | `terraform apply` in `infra/` — creates 5 buckets |
| 2 | After M4b SFN Terraform | `terraform apply` — deploys Step Functions state machine |
| 3 | After M4b Lambdas built | Deploy Lambdas via CI (OIDC + ECR) or terraform |
| 4 | After all M4b deployed | Run `./tests/escrow-flow.sh` against live AWS |
