# ─── Terraform ─────────────────────────────────────────────────────────
# Relowa POC — dev infrastructure
# eu-central-1 (Frankfurt)
# State: S3 backend with DynamoDB lock

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    bucket         = "relowa-terraform-state-258975980370"
    key            = "relowa/dev/terraform.tfstate"
    region         = "eu-central-1"
    dynamodb_table = "relowa-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "relowa"
      Env       = var.environment
      ManagedBy = "terraform"
    }
  }
}
