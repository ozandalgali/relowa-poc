/**
 * Seed data for Relowa POC.
 *
 * Creates three organizations:
 *  - Acme Industrial Solutions (producer)
 *  - EkoMetal Geri Dönüşüm (recycler)
 *  - Hızlı Lojistik (carrier)
 *
 * Each org has 2-3 users with different roles.
 *
 * Then seeds a couple of tenders so the RLS proof
 * tests have something concrete to filter against.
 *
 * NOTE on auth: passwords here are placeholders for the POC.
 * Real auth wiring (Better-Auth or Cognito) comes in a later step.
 * For now we just store bcrypt hashes so seed is realistic.
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, "../../../../.env") });
loadEnv();

import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://relowa:dev_password_change_me@localhost:5433/relowa";

const sql = postgres(connectionString, { max: 1 });

// Cheap deterministic password hash for the POC
// (real auth lib will replace this; same bcrypt format)
const FAKE_HASH =
  "$2b$10$ZZZZZZZZZZZZZZZZZZZZZ.ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ";

async function main() {
  console.log("→ seeding database...");

  // ============= 1. Clear (idempotent reseed) =============
  console.log("  · clearing existing seed data");
  await sql`DELETE FROM bids`;
  await sql`DELETE FROM tenders`;
  await sql`DELETE FROM org_members`;
  await sql`DELETE FROM organizations`;
  await sql`DELETE FROM users`;
  // We deliberately DO NOT clear audit_events — append-only invariant
  // means seed runs append, never delete.

  // ============= 2. Users =============
  console.log("  · creating users");
  const [acmeAhmet, acmeSelin, ekometalMehmet, ekometalAyse, hizliKadir] =
    await sql`
      INSERT INTO users (email, password_hash, full_name) VALUES
        ('ahmet@acme.example',     ${FAKE_HASH}, 'Ahmet Akman'),
        ('selin@acme.example',     ${FAKE_HASH}, 'Selin Bayrak'),
        ('mehmet@ekometal.example',${FAKE_HASH}, 'Mehmet Demir'),
        ('ayse@ekometal.example',  ${FAKE_HASH}, 'Ayşe Yıldız'),
        ('kadir@hizli.example',    ${FAKE_HASH}, 'Kadir Yılmaz')
      RETURNING id, email
    `;

  // ============= 3. Organizations =============
  console.log("  · creating organizations");
  const [acme, ekometal, hizli] = await sql`
    INSERT INTO organizations (type, name, vergi_no, region, address) VALUES
      ('producer', 'Acme Industrial Solutions', '1112223334', 'Kocaeli',  'Organize Sanayi Bölgesi, 4. Cadde No: 12'),
      ('recycler', 'EkoMetal Geri Dönüşüm',     '5556667778', 'Bursa',    'Demirtaş OSB, 8. Cadde No: 5'),
      ('carrier',  'Hızlı Lojistik',             '9990001112', 'İstanbul', 'Hadımköy Lojistik Üssü')
    RETURNING id, name
  `;

  // ============= 4. Memberships =============
  console.log("  · linking users to organizations");
  await sql`
    INSERT INTO org_members (org_id, user_id, role, accepted_at) VALUES
      (${acme.id},     ${acmeAhmet.id},     'admin',      now()),
      (${acme.id},     ${acmeSelin.id},     'accounting', now()),
      (${ekometal.id}, ${ekometalMehmet.id},'admin',      now()),
      (${ekometal.id}, ${ekometalAyse.id},  'operations', now()),
      (${hizli.id},    ${hizliKadir.id},    'admin',      now())
  `;

  // ============= 5. Tenders =============
  console.log("  · creating sample tenders");
  await sql`
    INSERT INTO tenders
      (org_id, created_by_user_id, material_type, quantity_tons, pickup_region, pickup_address, status, published_at, closes_at, notes)
    VALUES
      (${acme.id}, ${acmeAhmet.id}, 'metal_scrap', 20.000, 'Kocaeli',
       'Acme Foundry, Gebze tesisleri', 'published',
       now(), now() + interval '4 hours',
       'HMS 1&2 grade, balyalanmış, sahada hazır.'),
      (${acme.id}, ${acmeAhmet.id}, 'plastic',     12.500, 'Kocaeli',
       'Acme Foundry, Gebze tesisleri', 'published',
       now(), now() + interval '6 hours',
       'HDPE granül, endüstriyel sınıf, kuru.'),
      (${acme.id}, ${acmeAhmet.id}, 'paper',        8.000, 'Kocaeli',
       'Acme Foundry, Gebze tesisleri', 'draft',
       NULL, NULL,
       'Henüz yayınlanmadı.')
  `;

  // ============= 6. Done =============
  const counts = await sql<{ table_name: string; count: number }[]>`
    SELECT 'organizations' AS table_name, count(*) AS count FROM organizations
    UNION ALL SELECT 'users',         count(*) FROM users
    UNION ALL SELECT 'org_members',   count(*) FROM org_members
    UNION ALL SELECT 'tenders',       count(*) FROM tenders
    UNION ALL SELECT 'bids',          count(*) FROM bids
    UNION ALL SELECT 'audit_events',  count(*) FROM audit_events
    ORDER BY table_name
  `;

  console.log("");
  console.log("✓ seeding complete:");
  for (const row of counts) {
    console.log(`  ${row.table_name.padEnd(15)} ${row.count}`);
  }
  console.log("");
  console.log("Reference users (use these in the RLS proof tests):");
  console.log(`  Acme admin:        ${acmeAhmet.id}  ahmet@acme.example`);
  console.log(`  Acme accounting:   ${acmeSelin.id}  selin@acme.example`);
  console.log(`  EkoMetal admin:    ${ekometalMehmet.id}  mehmet@ekometal.example`);
  console.log(`  EkoMetal operations:${ekometalAyse.id} ayse@ekometal.example`);
  console.log(`  Hızlı admin:       ${hizliKadir.id}  kadir@hizli.example`);
  console.log("");
  console.log("Reference organizations:");
  console.log(`  Acme (producer):     ${acme.id}`);
  console.log(`  EkoMetal (recycler): ${ekometal.id}`);
  console.log(`  Hızlı (carrier):     ${hizli.id}`);

  await sql.end();
}

main().catch(async (err) => {
  console.error("✗ seed failed:", err);
  await sql.end();
  process.exit(1);
});
