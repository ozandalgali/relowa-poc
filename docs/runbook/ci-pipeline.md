# CI Pipeline Runbook

> GitHub Actions workflows, AWS OIDC trust, ECR/ECS/Lambda deploys, and the policy of "which stage runs when."
> Owner: `ci-cd-engineer`. Authority: ADR-0017 §8, ADR-0016, ADR-0014/0015.

## Workflows at a glance

```
.github/workflows/
├── lint.yml             # every PR: typecheck, lint, agents:check, i18n key lint, secret scan
├── test.yml             # every PR: unit, RLS isolation, migration smoke, audit chain
├── integration.yml      # PR with [full] label or push to main: api-integration, event-flow, state-machine, contract
├── e2e.yml              # nightly main: Playwright critical + full
├── visual.yml           # nightly main (P2): visual regression
├── security.yml         # weekly cron: OWASP ZAP, dep audit, gitleaks history
├── perf.yml             # weekly cron (P2): k6 bid storm + escrow batch
├── deploy-dev.yml       # push to main: build + deploy to dev account
├── deploy-prod.yml      # manual gate on main: build + deploy to prod account
└── compliance.yml       # weekly cron: automated KVKK assertions (P2)
```

P2-marked workflows have the YAML committed but `if:` gated to `${{ false }}` until P2 graduates. This keeps the file structure in place but inert.

## Triggers and budgets

| Workflow | Trigger | Time budget |
|---|---|---|
| `lint.yml` | every PR push | < 2 min |
| `test.yml` | every PR push | < 3 min |
| `integration.yml` | `[full]` label on PR OR push to `main` | < 8 min |
| `e2e.yml` | scheduled nightly 02:00 UTC + manual | < 30 min |
| `visual.yml` | scheduled nightly 02:30 UTC + manual (P2) | < 15 min |
| `security.yml` | scheduled weekly Sun 04:00 UTC + manual | < 30 min |
| `perf.yml` | scheduled weekly Sat 04:00 UTC + manual (P2) | < 60 min |
| `deploy-dev.yml` | push to `main` (after `test.yml` green) | < 10 min |
| `deploy-prod.yml` | manual `workflow_dispatch` from `main` | < 15 min |
| `compliance.yml` | scheduled weekly + manual (P2) | < 10 min |

## lint.yml — PR gate (~2 min)

```yaml
name: lint
on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm agents:check         # opencode ↔ claude drift gate
      - run: pnpm i18n:check           # missing TR keys
      - uses: gitleaks/gitleaks-action@v2
```

`pnpm agents:check` is described in `docs/agents/sync-strategy.md`.

## test.yml — PR gate (~3 min)

Brings up Docker compose (Postgres + LocalStack + Realtime), runs the substrate + unit + smoke tests.

```yaml
name: test
on:
  pull_request:
  push:
    branches: [main]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test                  # vitest unit, c8 coverage, thresholds enforced

  substrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker compose up -d postgres
      - run: ./scripts/wait-for-pg.sh
      - run: pnpm db:migrate && pnpm db:seed
      - run: ./tests/rls-isolation.sh
      - run: ./tests/migration-smoke.sh
      - run: ./tests/audit-chain.sh
```

Coverage thresholds enforced inside `vitest.config.ts` (ADR-0017 §4) — file paths only, no global gate.

## integration.yml — full suite (~8 min)

```yaml
name: integration
on:
  pull_request:
    types: [labeled, synchronize]
  push:
    branches: [main]

jobs:
  integration:
    if: contains(github.event.pull_request.labels.*.name, 'full') || github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    services:
      postgres:  # ...
      localstack:  # ...
    steps:
      - uses: actions/checkout@v4
      # ... install ...
      - run: docker compose up -d
      - run: pnpm db:reset
      - run: ./scripts/setup-events.sh
      - run: pnpm test:integration      # api-integration + event-flow
      - run: pnpm test:sfn              # state-machine
      - run: pnpm test:contract
      - run: ./tests/bidding-flow.sh
```

## e2e.yml — Playwright critical + full

PR: critical only (`--grep @critical`). Nightly: full.

```yaml
name: e2e
on:
  pull_request:
  schedule:
    - cron: '0 2 * * *'        # 02:00 UTC nightly
  workflow_dispatch:

jobs:
  playwright:
    runs-on: ubuntu-latest
    steps:
      # ... bring up the stack ...
      - run: pnpm exec playwright install chromium
      - name: critical (PR)
        if: github.event_name == 'pull_request'
        run: pnpm test:e2e -- --grep @critical
      - name: full (nightly)
        if: github.event_name == 'schedule'
        run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report/ }
```

## AWS OIDC trust

We do NOT store long-lived AWS keys in GitHub Secrets. Each workflow that touches AWS assumes a role via OIDC:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789012:role/relowa-dev-deploy
      role-session-name: gh-actions-${{ github.run_id }}
      aws-region: eu-central-1
```

Trust policy on the AWS role (least-privilege):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:relowa/relowa:ref:refs/heads/main"
      }
    }
  }]
}
```

Two roles:

- `relowa-dev-deploy` — trusted from any branch; deploys to dev account.
- `relowa-prod-deploy` — trusted from `main` only; deploys to prod account; additional MFA-equivalent via manual workflow dispatch gate.

## deploy-dev.yml

Triggered on push to `main` after `test.yml` is green.

```yaml
name: deploy-dev
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    needs: [lint, test]
    permissions: { id-token: write, contents: read }
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with: { role-to-assume: arn:aws:iam::DEV:role/relowa-dev-deploy, aws-region: eu-central-1 }

      - name: Build and push apps/api
        run: |
          docker build -t $ECR/relowa-api:${{ github.sha }} -f apps/api/Dockerfile .
          aws ecr get-login-password | docker login --username AWS --password-stdin $ECR
          docker push $ECR/relowa-api:${{ github.sha }}

      # ... same for apps/web, apps/admin, and each Lambda ...

      - name: Terraform plan + apply (dev)
        run: |
          cd infra
          terraform init
          terraform workspace select dev
          terraform apply -auto-approve -var "api_image_tag=${{ github.sha }}"

      - name: Smoke test
        run: |
          curl -fsS https://api.dev.relowa.com/health
          ./tests/dev-smoke.sh
```

## deploy-prod.yml

Manual gate on `main`:

```yaml
name: deploy-prod
on:
  workflow_dispatch:
    inputs:
      ref:
        description: 'Commit SHA on main to deploy'
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions: { id-token: write, contents: read }
    environment:
      name: production
      url: https://app.relowa.com
    steps:
      # ... same shape as dev, role = relowa-prod-deploy ...
      - name: Terraform plan
        run: terraform plan -out=plan.tfplan
      - name: Wait for approval
        # GitHub environment requires manual approval before next step
      - name: Terraform apply
        run: terraform apply plan.tfplan
      - name: Post-deploy smoke
        run: ./tests/prod-smoke.sh
```

The `production` GitHub environment requires manual approval by Ozan (super_admin) before any apply. Built-in to GitHub environments.

## Cost discipline

- GitHub Actions minutes: monitor; if a workflow regularly takes longer than its budget, fix it before adding stages.
- Cache aggressively: pnpm store, Docker layers, Playwright browsers.
- ECR lifecycle policy: delete untagged images > 30 days.
- CloudWatch log retention: dev 30 days, prod 90 days.

## Recovery — when deploys break

| Symptom | First step |
|---|---|
| `deploy-dev` fails on `terraform apply` | Read the plan diff; revert the offending PR if it's an IaC change. |
| Smoke test fails after deploy | Auto-rollback via ECS task definition revision pinning; investigate. |
| Lambda function errors after deploy | CloudWatch logs first; revert image tag via Terraform variable. |
| RDS migration fails mid-deploy | `pnpm db:migrate` is idempotent; rerun. If schema is half-applied, restore from PITR. |
| Production deploy has a bug | Rollback by re-running `deploy-prod.yml` with the previous-known-good SHA. |

## Adding a new workflow

1. Author the YAML in `.github/workflows/`.
2. Document its trigger + budget here.
3. Run it in a draft PR to verify.
4. Merge.
5. Update `tests/README.md` if the workflow runs a new test category.

## See also

- ADR-0015 §3 — VPN + private DNS for admin deploys
- ADR-0017 — Test strategy
- ADR-0016 — Agent team (ci-cd-engineer skill)
- `.opencode/skills/ci-cd-engineer.md`
- `docs/agents/sync-strategy.md` — the `agents:check` gate
