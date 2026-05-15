# ─── Outputs ──────────────────────────────────────────────────────────
# Values consumed by CI workflows and application config

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs (for RDS, ECS tasks, Lambda)"
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "Public subnet IDs (for ALB)"
  value       = aws_subnet.public[*].id
}

output "rds_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.main.endpoint
}

output "rds_port" {
  description = "RDS port"
  value       = aws_db_instance.main.port
}

output "rds_database_name" {
  description = "Database name"
  value       = var.db_name
}

output "ecr_repository_urls" {
  description = "ECR repository URLs"
  value = {
    api     = aws_ecr_repository.api.repository_url
    web     = aws_ecr_repository.web.repository_url
    admin   = aws_ecr_repository.admin.repository_url
    lambdas = aws_ecr_repository.lambdas.repository_url
  }
}

output "deploy_role_arn" {
  description = "Dev deploy role ARN (for GitHub Actions OIDC)"
  value       = aws_iam_role.dev_deploy.arn
}

output "db_master_password_secret_arn" {
  description = "Secrets Manager ARN for DB master password"
  value       = aws_secretsmanager_secret.db_master_password.arn
}

output "db_app_password_secret_arn" {
  description = "Secrets Manager ARN for DB app user password"
  value       = aws_secretsmanager_secret.db_app_password.arn
}

output "jwt_signing_key_secret_arn" {
  description = "Secrets Manager ARN for JWT signing key"
  value       = aws_secretsmanager_secret.jwt_signing_key.arn
}
