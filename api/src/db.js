// SQLite-lag for Hytteportal.
//
// Bruker better-sqlite3 (synkront, raskt, enkelt). Databasefilen ligger på stien
// i miljøvariabelen SQLITE_DB_PATH. På Azure Functions er lokal disk flyktig, så
// i produksjon bør stien peke til en montert Azure Files-share (f.eks.
// /mounted-data/hytteportal.db) slik at dataene overlever restart/skalering.
// Se docs/arkitektur.md.

const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const Database = require("better-sqlite3");

// De fire hyttene familien eier. Seedes ved første oppstart.
const CABINS = [
  { name: "Gartha rød", sort_order: 1 },
  { name: "Gartha hvit", sort_order: 2 },
  { name: "Gartha anneks", sort_order: 3 },
  { name: "Skeikampen", sort_order: 4 },
];

let db;

function getDb() {
  if (db) return db;

  const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, "..", "data", "hytteportal.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'member',   -- 'admin' | 'member'
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      code_hash  TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email);

    CREATE TABLE IF NOT EXISTS tokens (
      token_hash TEXT PRIMARY KEY,
      member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_member ON tokens(member_id);

    CREATE TABLE IF NOT EXISTS cabins (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Reservasjoner på døgnbasis. Inklusiv datointervall (start_date .. end_date).
    -- First-come-first-serve håndheves ved overlappsjekk i route-laget.
    CREATE TABLE IF NOT EXISTS bookings (
      id          TEXT PRIMARY KEY,
      cabin_id    TEXT NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      member_name TEXT NOT NULL,
      start_date  TEXT NOT NULL,   -- 'YYYY-MM-DD'
      end_date    TEXT NOT NULL,   -- 'YYYY-MM-DD' (inklusiv)
      note        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_cabin ON bookings(cabin_id, start_date, end_date);

    -- Handleliste. Eier kan redigere/slette; alle kan huke av 'bought'.
    CREATE TABLE IF NOT EXISTS purchases (
      id              TEXT PRIMARY KEY,
      cabin_id        TEXT NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      comment         TEXT,
      price           REAL,
      bought          INTEGER NOT NULL DEFAULT 0,
      bought_by_name  TEXT,
      bought_at       TEXT,
      created_by      TEXT REFERENCES members(id) ON DELETE SET NULL,
      created_by_name TEXT NOT NULL,
      source          TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'recurring'
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_purchases_cabin ON purchases(cabin_id);

    -- Faste utgifter som automatisk materialiseres til handlelista hver måned.
    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id               TEXT PRIMARY KEY,
      cabin_id         TEXT NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      title            TEXT NOT NULL,
      comment          TEXT,
      price            REAL,
      day_of_month     INTEGER NOT NULL DEFAULT 1,     -- 1..28
      active           INTEGER NOT NULL DEFAULT 1,
      last_generated   TEXT,                            -- 'YYYY-MM' sist generert
      created_by       TEXT REFERENCES members(id) ON DELETE SET NULL,
      created_by_name  TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_recurring_cabin ON recurring_expenses(cabin_id);

    -- Vedlikehold. Alle medlemmer kan redigere.
    CREATE TABLE IF NOT EXISTS maintenance (
      id               TEXT PRIMARY KEY,
      cabin_id         TEXT NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      title            TEXT NOT NULL,
      description      TEXT,
      status           TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'in_progress' | 'done'
      due_date         TEXT,                            -- 'YYYY-MM-DD'
      created_by       TEXT REFERENCES members(id) ON DELETE SET NULL,
      created_by_name  TEXT NOT NULL,
      updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_cabin ON maintenance(cabin_id);
  `);
}

function seed(db) {
  // Hytter
  const insertCabin = db.prepare(
    "INSERT OR IGNORE INTO cabins (id, name, sort_order) VALUES (?, ?, ?)"
  );
  const seedCabins = db.transaction(() => {
    for (const c of CABINS) insertCabin.run(randomUUID(), c.name, c.sort_order);
  });
  seedCabins();

  // Admin — fra env, med trygg fallback til eierens e-post.
  const adminEmail = (process.env.ADMIN_EMAIL || "jachrist2709@gmail.com").trim().toLowerCase();
  const adminName = (process.env.ADMIN_NAME || "Administrator").trim();
  const existing = db.prepare("SELECT id FROM members WHERE email = ?").get(adminEmail);
  if (!existing) {
    db.prepare(
      "INSERT INTO members (id, email, name, role) VALUES (?, ?, ?, 'admin')"
    ).run(randomUUID(), adminEmail, adminName);
  }
}

module.exports = { getDb };
