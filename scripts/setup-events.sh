#!/usr/bin/env bash
# scripts/setup-events.sh
#
# Sets up EventBridge resources in LocalStack for local dev.
# Creates the event bus, rules, and scheduler entries for the
# Relowa bidding loop per ADR-0009.
#
# Requires: LocalStack running on localhost:4566, awslocal CLI
# Run: ./scripts/setup-events.sh

set -euo pipefail

AWS_CMD="awslocal" # LocalStack CLI wrapper
# Fallback if awslocal not installed: use aws with --endpoint-url
if ! command -v awslocal &>/dev/null; then
  AWS_CMD="aws --endpoint-url=http://localhost:4566"
fi

REGION="${AWS_REGION:-eu-central-1}"
BUS_NAME="relowa-events"

echo "→ Setting up EventBridge resources in LocalStack (${REGION})..."

# ── Event bus ────────────────────────────────────────────────────────

echo "  → Creating event bus: ${BUS_NAME}"
${AWS_CMD} events create-event-bus --name "${BUS_NAME}" --region "${REGION}" 2>/dev/null || true

# ── Rules ────────────────────────────────────────────────────────────

# Rule: tender.created → log only
echo "  → Creating rule: tender.created"
${AWS_CMD} events put-rule \
  --name "tender-created" \
  --event-pattern '{"source":["relowa.api"],"detail-type":["tender.created"]}' \
  --event-bus-name "${BUS_NAME}" \
  --region "${REGION}" 2>/dev/null || true

# Rule: tender.published → SQS (email notifier)
echo "  → Creating rule: tender.published"
${AWS_CMD} events put-rule \
  --name "tender-published" \
  --event-pattern '{"source":["relowa.api"],"detail-type":["tender.published"]}' \
  --event-bus-name "${BUS_NAME}" \
  --region "${REGION}" 2>/dev/null || true

# Rule: bid.placed → SQS (email notifier)
echo "  → Creating rule: bid.placed"
${AWS_CMD} events put-rule \
  --name "bid-placed" \
  --event-pattern '{"source":["relowa.api"],"detail-type":["bid.placed"]}' \
  --event-bus-name "${BUS_NAME}" \
  --region "${REGION}" 2>/dev/null || true

# Rule: tender.won → SQS (email notifier)
echo "  → Creating rule: tender.won"
${AWS_CMD} events put-rule \
  --name "tender-won" \
  --event-pattern '{"source":["relowa.api"],"detail-type":["tender.won"]}' \
  --event-bus-name "${BUS_NAME}" \
  --region "${REGION}" 2>/dev/null || true

# ── Scheduler: auction close Lambda every 30s ────────────────────────

echo "  → Creating scheduler: auction-close (every 30s)"
${AWS_CMD} scheduler create-schedule \
  --name "auction-close" \
  --schedule-expression "rate(30 seconds)" \
  --flexible-time-window "Mode=OFF" \
  --target '{"Arn":"arn:aws:lambda:eu-central-1:000000000000:function:auction-close","RoleArn":"arn:aws:iam::000000000000:role/scheduler-role"}' \
  --region "${REGION}" 2>/dev/null || true

echo ""
echo "✓ EventBridge setup complete"
echo ""
echo "  Bus:      ${BUS_NAME}"
echo "  Rules:    tender.created, tender.published, bid.placed, tender.won"
echo "  Schedule: auction-close (every 30s)"
