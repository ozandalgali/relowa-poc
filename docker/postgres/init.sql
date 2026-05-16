-- Relowa POC — Postgres init
-- Bu dosya postgres container'ı ilk başladığında bir kez çalışır.
-- Realtime'ın ihtiyaç duyduğu publication ve replication setup'ını hazırlar.

-- Realtime için gerekli extension'lar
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- Realtime kullanıcısı (sadece replication için)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_realtime_admin') THEN
    CREATE ROLE supabase_realtime_admin WITH LOGIN REPLICATION PASSWORD 'dev_password_change_me';
  END IF;
END
$$;

-- Realtime'ın izleyeceği şemayı önceden hazırlıyoruz
-- (tablolar sonradan migration'larla geliyor)
CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO supabase_realtime_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO supabase_realtime_admin;

-- Realtime publication — ilk başta boş, schema'ya tablo eklendikçe genişler
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

-- Realtime'ın multi-tenant database'i (kendi metadata'sı için)
CREATE DATABASE realtime_metadata;

-- Bilgi mesajı
DO $$
BEGIN
  RAISE NOTICE '✓ Relowa Postgres init complete';
  RAISE NOTICE '  - pgcrypto + uuid-ossp extensions installed';
  RAISE NOTICE '  - supabase_realtime_admin role created';
  RAISE NOTICE '  - supabase_realtime publication created (empty, add tables later)';
  RAISE NOTICE '  - app schema created for application tables';
END
$$;
