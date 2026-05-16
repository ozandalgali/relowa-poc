# ─── EventBridge Scheduler — Auction Close + Audit Export ───────────

# Scheduler IAM role
resource "aws_iam_role" "scheduler" {
  name = "relowa-${var.environment}-scheduler-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_policy" "scheduler_invoke_lambda" {
  name = "relowa-${var.environment}-scheduler-invoke-lambda"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["lambda:InvokeFunction"]
      Resource = [
        "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:relowa-${var.environment}-*"
      ]
    }]
  })
}

resource "aws_iam_role_policy_attachment" "scheduler_lambda" {
  role       = aws_iam_role.scheduler.name
  policy_arn = aws_iam_policy.scheduler_invoke_lambda.arn
}

# Auction close — every 30 seconds
resource "aws_scheduler_schedule" "auction_close" {
  name = "relowa-${var.environment}-auction-close"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = "rate(30 seconds)"

  target {
    arn      = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:relowa-${var.environment}-auction-close"
    role_arn = aws_iam_role.scheduler.arn
  }

  tags = { Name = "relowa-${var.environment}-auction-close-schedule", Module = "marketplace" }
}

# Daily audit export — 03:00 UTC
resource "aws_scheduler_schedule" "audit_export" {
  name = "relowa-${var.environment}-audit-export"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = "cron(0 3 * * ? *)"

  target {
    arn      = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:relowa-${var.environment}-audit-export"
    role_arn = aws_iam_role.scheduler.arn
  }

  tags = { Name = "relowa-${var.environment}-audit-export-schedule", Module = "compliance" }
}
