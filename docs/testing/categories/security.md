# Test category — Security

**Status:** 📋 P1 (CI steps automated).
**Owner:** `ci-cd-engineer` (wires automation); `compliance-specialist` (reviews findings).
**Runner:** Multiple — `gitleaks`, `pnpm audit`, `npm audit`, OWASP ZAP, custom scripts.
**Location:** `.github/workflows/security.yml`; reports in `tests/security-reports/`.

## Purpose

Automate continuous security review. Surface dependency vulnerabilities, exposed secrets, common web vulnerabilities, and known-bad patterns in code.

## P1 checks (every CI run + weekly cron)

| Check | Tool | Trigger | What it catches |
|---|---|---|---|
| Secret scan in commits | `gitleaks` | Every push, every PR | API keys, tokens, AWS creds accidentally committed |
| Secret scan in history | `gitleaks --log-opts="-N main"` | Weekly cron | Secrets in past commits we missed |
| Dep audit (npm) | `pnpm audit --audit-level=high` | Every push | High/critical CVEs in dependencies |
| OWASP ZAP baseline | `zap-baseline.py` | Weekly cron against dev | XSS, missing security headers, common misconfigs |
| Container image scan | `trivy image` | Before push to ECR | CVEs in base images and packages |
| IAM policy lint | `cfn-nag` or custom | Terraform plan | Overly broad IAM `*` permissions |
| Header check | Playwright assertion | E2E suite | CSP, HSTS, X-Frame-Options set on `apps/web` |

## Test shape examples

**Secret scan in code:**

```yaml
# .github/workflows/security.yml
- name: gitleaks scan
  uses: gitleaks/gitleaks-action@v2
  with:
    config: .gitleaks.toml
```

**Header check via Playwright:**

```ts
test('apps/web sets strict security headers', async ({ request }) => {
  const response = await request.get('/');
  expect(response.headers()['content-security-policy']).toBeDefined();
  expect(response.headers()['strict-transport-security']).toMatch(/max-age=\d+/);
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
});
```

**ZAP baseline:**

```yaml
- name: OWASP ZAP baseline scan
  uses: zaproxy/action-baseline@v0.10.0
  with:
    target: 'https://app.dev.relowa.com'
    rules_file_name: '.zap/rules.tsv'
    fail_action: false   # Soft fail in P1; hard fail in P2
```

## Findings handling

- **Critical / high severity:** PR blocked. Fix or document an explicit exception (`docs/compliance/exceptions/<CVE>.md`).
- **Medium:** Tracked in `docs/compliance/security-backlog.md`. Reviewed weekly.
- **Low / informational:** Logged, not blocking.

## P2 additions

- **DAST against staging.** Authenticated ZAP scan with real session.
- **SAST.** `semgrep` rules for project-specific anti-patterns (e.g. "no `auth.uid()` in app code," "no inline hex in `packages/ui/`").
- **Pen test gate** before launch.
- **Bug bounty program** post-launch.

## Non-negotiables

- ❌ Never disable a security check to make CI green. Document the exception with rationale.
- ❌ Never push a Docker image with critical CVEs.
- ❌ Never commit `.env` or any file matching `.gitleaks.toml` allowlist.
- ✅ Always investigate every high-severity dep audit finding within 7 days.

## See also

- `.opencode/skills/ci-cd-engineer.md`
- `.opencode/skills/compliance-specialist.md`
- `docs/runbook/ci-pipeline.md`
