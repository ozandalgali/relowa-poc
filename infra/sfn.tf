# ─── Step Functions — Escrow State Machine ──────────────────────────

resource "aws_sfn_state_machine" "escrow" {
  name     = "relowa-${var.environment}-escrow"
  role_arn = aws_iam_role.escrow_sfn.arn

  definition = file("${path.module}/../apps/lambdas/escrow/state-machine.asl.json")

  tags = { Name = "relowa-${var.environment}-escrow-sfn", Module = "escrow" }
}

resource "aws_iam_role" "escrow_sfn" {
  name = "relowa-${var.environment}-escrow-sfn-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "states.${var.aws_region}.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_policy" "escrow_sfn_lambda_invoke" {
  name = "relowa-${var.environment}-escrow-sfn-lambda-invoke"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = [
        "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:relowa-${var.environment}-escrow-*"
      ]
    }]
  })
}

resource "aws_iam_role_policy_attachment" "escrow_sfn_lambda" {
  role       = aws_iam_role.escrow_sfn.name
  policy_arn = aws_iam_policy.escrow_sfn_lambda_invoke.arn
}

data "aws_caller_identity" "current" {}
