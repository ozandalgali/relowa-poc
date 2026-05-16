# ─── S3 Buckets (ADR-0019) ──────────────────────────────────────────

# ── Tender photos ────────────────────────────────────────────────────
resource "aws_s3_bucket" "tender_photos" {
  bucket = "relowa-${var.environment}-tender-photos"

  tags = { Name = "relowa-${var.environment}-tender-photos", Module = "storage" }
}

resource "aws_s3_bucket_lifecycle_configuration" "tender_photos" {
  bucket = aws_s3_bucket.tender_photos.id

  rule {
    id     = "expire-old-photos"
    status = "Enabled"

    expiration {
      days = 365
    }
  }
}

# ── Org documents ────────────────────────────────────────────────────
resource "aws_s3_bucket" "org_documents" {
  bucket = "relowa-${var.environment}-org-documents"

  tags = { Name = "relowa-${var.environment}-org-documents", Module = "storage" }
}

resource "aws_s3_bucket_lifecycle_configuration" "org_documents" {
  bucket = aws_s3_bucket.org_documents.id

  rule {
    id     = "expire-old-docs"
    status = "Enabled"

    expiration {
      days = 730 # 2 years — KVKK retention
    }
  }
}

# ── E-fatura ─────────────────────────────────────────────────────────
resource "aws_s3_bucket" "efatura" {
  bucket = "relowa-${var.environment}-efatura"

  tags = { Name = "relowa-${var.environment}-efatura", Module = "storage" }
}

resource "aws_s3_bucket_lifecycle_configuration" "efatura" {
  bucket = aws_s3_bucket.efatura.id

  rule {
    id     = "expire-old-invoices"
    status = "Enabled"

    expiration {
      days = 3650 # 10 years — tax regulation
    }
  }
}

# ── Audit archive (Object Lock WORM) ─────────────────────────────────
resource "aws_s3_bucket" "audit_archive" {
  bucket = "relowa-${var.environment}-audit-archive"

  object_lock_enabled = true # WORM — once written, immutable for lock period

  tags = { Name = "relowa-${var.environment}-audit-archive", Module = "compliance" }
}

resource "aws_s3_bucket_object_lock_configuration" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id

  rule {
    default_retention {
      mode = "COMPLIANCE" # Immutable even for root account
      days = 365
    }
  }
}

resource "aws_s3_bucket_versioning" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id
  versioning_configuration {
    status = "Enabled"
  }
}

# ── Public assets (ESG certs, static files) ──────────────────────────
resource "aws_s3_bucket" "public_assets" {
  bucket = "relowa-${var.environment}-public-assets"

  tags = { Name = "relowa-${var.environment}-public-assets", Module = "storage" }
}

# ── Block public access on all buckets except public-assets ──────────
resource "aws_s3_bucket_public_access_block" "tender_photos" {
  bucket                  = aws_s3_bucket.tender_photos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "org_documents" {
  bucket                  = aws_s3_bucket.org_documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "efatura" {
  bucket                  = aws_s3_bucket.efatura.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "audit_archive" {
  bucket                  = aws_s3_bucket.audit_archive.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── Encryption at rest (KMS managed) ──────────────────────────────────
resource "aws_s3_bucket_server_side_encryption_configuration" "tender_photos" {
  bucket = aws_s3_bucket.tender_photos.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "org_documents" {
  bucket = aws_s3_bucket.org_documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "efatura" {
  bucket = aws_s3_bucket.efatura.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "public_assets" {
  bucket = aws_s3_bucket.public_assets.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
