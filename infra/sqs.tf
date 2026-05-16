# ─── SQS — Webhook Processing Queue ─────────────────────────────────

resource "aws_sqs_queue" "webhook_dlq" {
  name                      = "relowa-${var.environment}-webhook-dlq"
  message_retention_seconds = 1209600 # 14 days
  tags = { Name = "relowa-${var.environment}-webhook-dlq", Module = "escrow" }
}

resource "aws_sqs_queue" "webhook_processing" {
  name = "relowa-${var.environment}-webhook-processing"

  visibility_timeout_seconds = 30
  message_retention_seconds  = 86400 # 24 hours

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.webhook_dlq.arn
    maxReceiveCount     = 5
  })

  tags = { Name = "relowa-${var.environment}-webhook-processing", Module = "escrow" }
}
