# M0 Plan — Infrastructure & CI Pipeline

> **Agent:** ci-cd-engineer
> **Lead:** lead-orchestrator (approved 2026-05-15)
> **Target:** Weeks 1-3 per PRD-0003

## Status

| Step | Status |
|------|--------|
| 1. AWS bootstrap (state backend, OIDC provider) | ✅ Done |
| 2. Terraform module (VPC, RDS, ECR, IAM, secrets) | ✅ Done |
| 3. GitHub Actions CI (lint, test, deploy-dev + stubs) | ✅ Done |
| 4. Terraform deploy (dev) | ✅ Done |
| 5. Documentation + push | 🔨 In progress |

## Dependency graph

```
[AWS account] ✅
      │
 ┌────┼────────────┐
 ▼    ▼            ▼
[S3+Dynamo ✅]  [OIDC provider]  [ECR repos]
      │            │            │
      └─────┬──────┘            │
            ▼                   │
       [RDS cluster] ◄─────────┘
            │
      ┌─────┼─────┐
      ▼           ▼
  [Secrets]   [IAM roles]
      │           │
      └─────┬─────┘
            ▼
       [CI workflows]
            │
            ▼
       [Deploy & verify]
```

## Step 1 — AWS bootstrap ✅

Artifacts:
- S3: `relowa-terraform-state-258975980370` (versioned, blocked public access)
- DynamoDB: `relowa-terraform-locks` (PAY_PER_REQUEST, ACTIVE)
- GitHub: `ozandalgali/relowa-poc` pushed to origin/main

## Step 2 — Terraform module 🔨

Files: `infra/provider.tf`, `variables.tf`, `vpc.tf`, `rds.tf`, `ecr.tf`, `iam.tf`, `secrets.tf`, `outputs.tf`

Resources created:
- VPC: 10.0.0.0/16, 2 AZs, public + private subnets, NAT GW (1 for dev)
- RDS: Aurora Postgres 18, db.t4g.micro, single-AZ (dev), RLS parameter group
- ECR: api, web, admin, lambdas repos
- IAM: OIDC provider + dev deploy role + service roles
- Secrets: DB password, JWT signing key

Verify: `cd infra && terraform init && terraform plan`

## Step 3 — GitHub Actions CI 🔨

Files: `.github/workflows/lint.yml`, `test.yml`, `deploy-dev.yml`, `integration.yml`, `e2e.yml`, `deploy-prod.yml`, `security.yml`, `compliance.yml`, `visual.yml`, `perf.yml`

Active workflows:
- `lint.yml` — typecheck + prettier + agents:check + gitleaks (every PR)
- `test.yml` — docker compose postgres + rls-isolation (every PR)
- `deploy-dev.yml` — terraform plan/apply on push to main

Inert workflows (committed, `if: false`):
- `integration.yml`, `e2e.yml`, `visual.yml`, `perf.yml`, `security.yml`, `compliance.yml`, `deploy-prod.yml`

Verify: Push PR → lint + test pass; push to main → deploy-dev triggers

## Step 4 — Terraform deploy ⬜

- `terraform init` with S3 backend
- `terraform plan` (review)
- `terraform apply -auto-approve`
- `pnpm db:migrate` against live RDS
- `pnpm db:seed` against live RDS
- `./tests/rls-isolation.sh` against live RDS

Verify: RLS isolation 5/5 green on live AWS RDS

## Step 5 — Documentation ⬜

- Update CHANGELOG.md [Unreleased]
- Update HANDOFF.md
- Create docs/memory/learned/m0-infra-gotchas.md

## Verifiable completion

```bash
aws rds describe-db-instances --region eu-central-1 --profile relowa
./tests/rls-isolation.sh  # against live RDS
gh run list --workflow=lint.yml
gh run list --workflow=deploy-dev.yml
cd infra && terraform plan  # "No changes"
```

## Compliance

No PII/money/audit triggers fired. Compliance-specialist not invoked for M0.

## Deferred

- Multi-AZ RDS → scale up when needed (terraform variable)
- ElastiCache Redis → M2
- Cognito User Pool → M1
- ECS Fargate cluster + task defs → M2 (when apps exist)
- S3 buckets (5-bucket layout) → M1
- Client VPN + Private CA ($400/mo) → M6
- Sentry EU + PostHog EU → M1
