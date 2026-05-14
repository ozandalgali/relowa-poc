---
skill: ci-cd-engineer
purpose: Own GitHub Actions workflows, AWS OIDC, IAM, ECR/ECS/Lambda deploys, Terraform/CDK IaC, and the agent-sync check.
squad: devops
required_reading:
  - AGENTS.md
  - docs/runbook/ci-pipeline.md
  - docs/adr/0009-local-bidding-architecture.md
  - docs/adr/0007-step-functions-escrow.md
  - docs/adr/0015-admin-tooling-isolation.md
  - docs/adr/0012-frontend-app-architecture.md
---

# Skill: ci-cd-engineer

## When to invoke

- Adding a new GitHub Actions workflow or stage.
- Wiring AWS OIDC trust between GitHub and AWS.
- Creating ECR repositories, ECS task definitions, Lambda functions, IAM roles.
- Authoring Terraform / CDK modules.
- Configuring the VPN endpoint, private hosted zone, ALBs.
- Tuning the agents-sync check (`pnpm agents:check`).
- Investigating a failing pipeline or a failed deploy.

**Do NOT invoke this skill for:**
- App-level logic — that's the relevant squad.
- Test writing — that's `tester`.
- Schema infra (RDS parameter groups touch perf — that's `db-operator` with this skill's coordination for the IaC).

## Required reading

- `AGENTS.md`
- `docs/runbook/ci-pipeline.md`
- `docs/adr/0009-local-bidding-architecture.md` (the bidding loop infra)
- `docs/adr/0007-step-functions-escrow.md` (escrow infra)
- `docs/adr/0015-admin-tooling-isolation.md` (VPN, IAM Identity Center, private DNS)
- `docs/adr/0012-frontend-app-architecture.md` (two-app deploy split)
- The relevant Terraform/CDK module being modified

## Inputs

- The infrastructure delta (new service, new stage, new IAM role).
- AWS account topology (we use `relowa-dev` and `relowa-prod`; production in `eu-central-1`).
- The change's blast radius (which services are affected if the change fails).

## Outputs

For a new CI stage:
- `.github/workflows/<workflow>.yml` update.
- Updated `docs/runbook/ci-pipeline.md` describing the new stage's purpose and triggers.
- Smoke test that the stage runs on a representative PR.

For a new deploy target:
- Terraform / CDK module under `infra/` (e.g. `infra/escrow-state-machine/`).
- AWS OIDC trust policy update if a new role is needed (least-privilege).
- ECR repository if a container is involved.
- CloudWatch log group + alarm.
- Updated `docs/runbook/ci-pipeline.md` deployment section.

For agent-sync work:
- `scripts/sync-agents.ts` (the duplication-discipline script).
- Pre-commit / pre-push hook integration (lefthook config).
- CI stage `pnpm agents:check` in lint workflow.

## The CI shape (target)

```
.github/workflows/
├── lint.yml         (PR — every push)
│   - typecheck, eslint, prettier, agents:check, secret scan, i18n key lint
├── test.yml         (PR — every push)
│   - unit (Vitest), RLS isolation (bash), migration smoke
├── integration.yml  (PR — on `[full]` label or push to main)
│   - api-integration, event-flow, state-machine
├── e2e.yml          (PR — nightly on main)
│   - Playwright E2E
├── visual.yml       (nightly main — P2 graduating)
│   - visual regression
├── deploy-dev.yml   (push to main)
│   - build images, push ECR, deploy ECS / Lambda to dev account
├── deploy-prod.yml  (manual gate on main)
│   - build images, deploy to prod via Terraform plan + apply
└── compliance.yml   (weekly cron)
    - automated KVKK / dependency audit, ZAP scan against dev
```

Each workflow runs on GitHub-hosted runners. AWS deploys use OIDC short-lived credentials — no long-lived AWS keys in GitHub secrets.

## AWS deploy targets (P1)

| Service | Target |
|---|---|
| `apps/web` | ECS Fargate behind public ALB at `app.relowa.com` |
| `apps/admin` | ECS Fargate behind **internal-only** ALB at `admin.relowa.local` |
| `apps/api` | ECS Fargate behind public ALB at `api.relowa.com` |
| `apps/lambdas/tender-close-handler` | Lambda + EventBridge Scheduler rule |
| `apps/lambdas/escrow-tasks/*` | Lambda functions, targeted by Step Functions |
| `apps/lambdas/outbox-relay` | Lambda + SQS DLQ |
| RDS, ElastiCache, S3, SQS, EventBridge, AppSync, Cognito, IAM Identity Center, Client VPN | Terraform-managed |

## OIDC + least-privilege

Every GitHub Actions deploy role:

- Trusted only from this repo, this branch.
- Permissions scoped to the resources it deploys (no `*` on `iam:`).
- Auditable in CloudTrail.
- Rotation tested quarterly (rotate the trust condition's audience claim, verify deploy still works).

## Non-negotiables

- ❌ **Never** store long-lived AWS keys in GitHub secrets. OIDC only.
- ❌ **Never** skip CI on a deploy ("hot fix" branch goes through the same lint + test).
- ❌ **Never** deploy to prod from any branch other than `main`.
- ❌ **Never** widen an IAM role's permissions without an ADR or a runbook entry justifying.
- ❌ **Never** publish an admin-app image to a public ECR repository. Admin tooling artifacts stay internal.
- ✅ **Always** smoke-test a deploy in dev before promoting.
- ✅ **Always** include a rollback path in the runbook for any new deploy stage.
- ✅ **Always** propagate `agents:check` failures to a hard CI fail.

## Cost discipline

- GitHub Actions minutes: monitor monthly; if exceeding free tier consider self-hosted runners.
- AWS: tag every resource (`Project=relowa`, `Env=dev|prod`, `Module=marketplace|logistics|...`). Cost Explorer is unusable without tags.
- ECR: lifecycle policy to delete untagged images > 30 days.
- CloudWatch logs: 30-day retention dev, 90-day retention prod (cost vs forensics tradeoff).

## Verification

```bash
# Local
pnpm typecheck && pnpm lint && pnpm test

# Workflow dry run via act
act -W .github/workflows/lint.yml

# Terraform plan
cd infra/<module> && terraform plan
```

## See also

- `docs/runbook/ci-pipeline.md` (this skill's runbook)
- `.opencode/skills/tester.md` — what runs in CI
- `docs/agents/sync-strategy.md` — the agents:check the script enforces
- `docs/adr/0015-admin-tooling-isolation.md` — private DNS + VPN deploys
