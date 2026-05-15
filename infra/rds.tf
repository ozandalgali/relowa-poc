# ─── RDS PostgreSQL ───────────────────────────────────────────────────

# DB subnet group (private subnets only)
resource "aws_db_subnet_group" "main" {
  name        = "relowa-${var.environment}-db-subnet"
  description = "Subnet group for RDS - private subnets"
  subnet_ids  = aws_subnet.private[*].id

  tags = { Name = "relowa-${var.environment}-db-subnet" }
}

# Security group for RDS
resource "aws_security_group" "rds" {
  name        = "relowa-${var.environment}-rds-sg"
  description = "Security group for RDS PostgreSQL"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
    description = "Postgres from within VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "relowa-${var.environment}-rds-sg" }
}

# RDS parameter group — wal_level logical for Realtime CDC
resource "aws_db_parameter_group" "main" {
  name        = "relowa-${var.environment}-pg"
  family      = "postgres18"
  description = "Relowa parameter group - wal_level logical, pg_stat_statements"

  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  parameter {
    name         = "rds.logical_replication"
    value        = "1"
    apply_method = "pending-reboot"
  }

  tags = { Name = "relowa-${var.environment}-pg" }
}

# DB master password
resource "random_password" "db_master" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "db_master_password" {
  name        = "/relowa/${var.environment}/db/master-password"
  description = "RDS PostgreSQL master password for ${var.environment}"
}

resource "aws_secretsmanager_secret_version" "db_master_password" {
  secret_id     = aws_secretsmanager_secret.db_master_password.id
  secret_string = random_password.db_master.result
}

# RDS PostgreSQL instance
resource "aws_db_instance" "main" {
  identifier     = "relowa-${var.environment}"
  engine         = "postgres"
  engine_version = "18.4"

  instance_class         = var.db_instance_class
  allocated_storage      = 20
  max_allocated_storage  = 100
  storage_encrypted      = true
  storage_type           = "gp3"

  db_name  = var.db_name
  username = var.db_master_username
  password = random_password.db_master.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.main.name

  publicly_accessible    = false
  multi_az               = false
  skip_final_snapshot    = var.environment == "dev" ? true : false
  deletion_protection    = var.environment == "prod" ? true : false
  backup_retention_period = var.environment == "prod" ? 35 : 1
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"

  tags = { Name = "relowa-${var.environment}-db" }
}

# Application user password
resource "random_password" "db_app" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "db_app_password" {
  name        = "/relowa/${var.environment}/db/app-user-password"
  description = "Application user password for ${var.environment}"
}

resource "aws_secretsmanager_secret_version" "db_app_password" {
  secret_id     = aws_secretsmanager_secret.db_app_password.id
  secret_string = random_password.db_app.result
}

# JWT signing key for API session tokens
resource "random_password" "jwt_signing_key" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "jwt_signing_key" {
  name        = "/relowa/${var.environment}/api/jwt-signing-key"
  description = "Hono API JWT HMAC signing key for ${var.environment}"
}

resource "aws_secretsmanager_secret_version" "jwt_signing_key" {
  secret_id     = aws_secretsmanager_secret.jwt_signing_key.id
  secret_string = random_password.jwt_signing_key.result
}
