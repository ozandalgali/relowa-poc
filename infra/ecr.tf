# ─── ECR Repositories ─────────────────────────────────────────────────

# API (Hono backend)
resource "aws_ecr_repository" "api" {
  name = "relowa-${var.environment}-api"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = "relowa-${var.environment}-api", Module = "api" }
}

# Web frontend (Next.js)
resource "aws_ecr_repository" "web" {
  name = "relowa-${var.environment}-web"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = "relowa-${var.environment}-web", Module = "web" }
}

# Admin panel (Next.js, internal only)
resource "aws_ecr_repository" "admin" {
  name = "relowa-${var.environment}-admin"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = "relowa-${var.environment}-admin", Module = "admin" }
}

# Lambdas (shared repo for all Lambda function images)
resource "aws_ecr_repository" "lambdas" {
  name = "relowa-${var.environment}-lambdas"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = "relowa-${var.environment}-lambdas", Module = "lambdas" }
}

# ─── Lifecycle policies ───────────────────────────────────────────────

resource "aws_ecr_lifecycle_policy" "untagged_cleanup" {
  for_each = {
    api     = aws_ecr_repository.api.name
    web     = aws_ecr_repository.web.name
    admin   = aws_ecr_repository.admin.name
    lambdas = aws_ecr_repository.lambdas.name
  }

  repository = each.value

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Delete untagged images older than 30 days"
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}
