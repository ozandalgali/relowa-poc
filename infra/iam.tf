# ─── IAM — OIDC + Deploy Roles + Service Roles ────────────────────────

# ── GitHub OIDC Provider ─────────────────────────────────────────────

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = { Name = "relowa-github-oidc" }
}

# ── Deploy role trust policy ──────────────────────────────────────────

data "aws_iam_policy_document" "github_oidc_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:ozandalgali/relowa-poc:ref:refs/heads/main",
        "repo:ozandalgali/relowa-poc:ref:refs/heads/feature/*",
        "repo:ozandalgali/relowa-poc:pull_request",
      ]
    }
  }
}

# ── Dev deploy role ───────────────────────────────────────────────────

resource "aws_iam_role" "dev_deploy" {
  name               = "relowa-dev-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_oidc_trust.json
  description        = "GitHub Actions deploy role for relowa dev environment"

  tags = { Name = "relowa-dev-deploy" }
}

# AdministratorAccess for POC — scoped by OIDC trust condition
# Narrow to specific service actions when moving to production
data "aws_iam_policy" "administrator_access" {
  arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

resource "aws_iam_role_policy_attachment" "dev_deploy_admin" {
  role       = aws_iam_role.dev_deploy.name
  policy_arn = data.aws_iam_policy.administrator_access.arn
}

# ── ECS Task Execution Role ───────────────────────────────────────────

data "aws_iam_policy_document" "ecs_task_execution_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "relowa-${var.environment}-ecs-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_execution_trust.json
  description        = "ECS task execution role - pulls images, reads secrets"

  tags = { Name = "relowa-${var.environment}-ecs-task-execution" }
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_base" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow ECS tasks to read application secrets
data "aws_iam_policy_document" "ecs_secrets_read" {
  statement {
    actions = [
      "secretsmanager:GetSecretValue",
    ]
    resources = [
      aws_secretsmanager_secret.db_app_password.arn,
      aws_secretsmanager_secret.jwt_signing_key.arn,
    ]
  }
}

resource "aws_iam_policy" "ecs_secrets_read" {
  name        = "relowa-${var.environment}-ecs-secrets-read"
  description = "Allow ECS tasks to read application secrets"
  policy      = data.aws_iam_policy_document.ecs_secrets_read.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_secrets" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = aws_iam_policy.ecs_secrets_read.arn
}

# ── Lambda Execution Role (placeholder) ───────────────────────────────

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_execution" {
  name               = "relowa-${var.environment}-lambda-execution"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
  description        = "Lambda execution role - CloudWatch logs + VPC access"

  tags = { Name = "relowa-${var.environment}-lambda-execution" }
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "lambda_vpc_access" {
  role       = aws_iam_role.lambda_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Allow Lambda to read DB + JWT secrets
data "aws_iam_policy_document" "lambda_secrets_read" {
  statement {
    actions = [
      "secretsmanager:GetSecretValue",
    ]
    resources = [
      aws_secretsmanager_secret.db_app_password.arn,
      aws_secretsmanager_secret.jwt_signing_key.arn,
    ]
  }
}

resource "aws_iam_policy" "lambda_secrets_read" {
  name        = "relowa-${var.environment}-lambda-secrets-read"
  description = "Allow Lambda functions to read application secrets"
  policy      = data.aws_iam_policy_document.lambda_secrets_read.json
}

resource "aws_iam_role_policy_attachment" "lambda_execution_secrets" {
  role       = aws_iam_role.lambda_execution.name
  policy_arn = aws_iam_policy.lambda_secrets_read.arn
}
