# ─── Variables ────────────────────────────────────────────────────────

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "eu-central-1"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "db_instance_class" {
  description = "RDS instance class (db.t4g.micro for dev, scale up for prod)"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "relowa"
}

variable "db_master_username" {
  description = "RDS master username"
  type        = string
  default     = "relowa"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "AZs to use (2 for dev)"
  type        = list(string)
  default     = ["eu-central-1a", "eu-central-1b"]
}
