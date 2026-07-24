// Datalag for Hytteportal — SQLite via better-sqlite3.
//
// Kjører i samme Node/Express-prosess. Databasefilen ligger på stien i
// SQLITE_DB_PATH; på Azure App Service peker den til den vedvarende /home-disken
// (f.eks. /home/data/hytteportal.db), slik at dataene overlever restart og deploy.
//
// better-sqlite3 er synkront, men vi eksponerer et async grensesnitt
// (query/queryOne/exec/withTx) slik at kall-laget (auth.js + routes) kan bruke
// await uniformt. Parametere sendes som posisjonelle '?' (array) eller navngitte
// '@name' (objekt) — begge støttes av better-sqlite3.

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
  const dbPath =
    process.env.SQLITE_DB_PATH || path.join(__dirname, "..", "data", "hytteportal.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  // MERK: WAL-modus krever delt minne (mmap) som IKKE støttes på Azure Files
  // (/home på App Service, CIFS). Bruk rollback-journal (DELETE) som virker på
  // nettverksmonterte filsystemer. F1 er én instans, så WAL trengs ikke.
  db.pragma("journal_mode = DELETE");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seed(db);
  return db;
}

// Kjører en prepared statement. Returnerer rader for SELECT, ellers [].
// Aksepterer params som array (posisjonelle '?') eller objekt (navngitte '@name').
function run(text, params) {
  const stmt = getDb().prepare(text);
  const args = params == null ? [] : Array.isArray(params) ? params : [params];
  if (stmt.reader) return stmt.all(...args);
  stmt.run(...args);
  return [];
}

// SELECT som returnerer alle rader.
async function query(text, params) {
  return run(text, params);
}

// SELECT som returnerer første rad (eller undefined).
async function queryOne(text, params) {
  return run(text, params)[0];
}

// INSERT/UPDATE/DELETE. Returnerer antall berørte rader.
async function exec(text, params) {
  const stmt = getDb().prepare(text);
  const args = params == null ? [] : Array.isArray(params) ? params : [params];
  return stmt.run(...args).changes;
}

// Kjører fn innenfor en transaksjon (BEGIN IMMEDIATE gir skrivelås). fn får en
// query-funksjon med samme signatur som query(). Brukes der lese-så-skrive må
// være atomisk (FCFS-booking, faste utgifter). better-sqlite3 er synkront, så
// ingen andre DB-operasjoner interleaver mellom await-punktene her.
async function withTx(fn) {
  const database = getDb();
  database.exec("BEGIN IMMEDIATE");
  try {
    const txQuery = async (text, params) => run(text, params);
    const result = await fn(txQuery);
    database.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* rollback kan feile hvis transaksjonen allerede er avbrutt */
    }
    throw err;
  }
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id         TEXT NOT NULL PRIMARY KEY,
      email      TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'member',            -- 'admin' | 'member'
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id         TEXT NOT NULL PRIMARY KEY,
      email      TEXT NOT NULL,
      code_hash  TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email);

    CREATE TABLE IF NOT EXISTS tokens (
      token_hash TEXT NOT NULL PRIMARY KEY,
      member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_member ON tokens(member_id);

    CREATE TABLE IF NOT EXISTS cabins (
      id         TEXT NOT NULL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Reservasjoner på døgnbasis. Inklusiv datointervall (start_date .. end_date,
    -- lagret som 'YYYY-MM-DD'-strenger). FCFS håndheves ved overlappsjekk i route-laget.
    CREATE TABLE IF NOT EXISTS bookings (
      id          TEXT NOT NULL PRIMARY KEY,
      cabin_id    TEXT NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      member_name TEXT NOT NULL,
      start_date  TEXT NOT NULL,
      end_date    TEXT NOT NULL,
      note        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_cabin ON bookings(cabin_id, start_date, end_date);

    -- Handleliste. Eier kan redigere/slette; alle kan huke av 'bought'.
    CREATE TABLE IF NOT EXISTS purchases (
      id              TEXT NOT NULL PRIMARY KEY,
      cabin_id        TEXT NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      comment         TEXT,
      price           REAL,
      bought          INTEGER NOT NULL DEFAULT 0,
      bought_by_name  TEXT,
      bought_at       TEXT,
      created_by      TEXT REFERENCES members(id) ON DELETE SET NULL,
      created_by_name TEXT NOT NULL,
      source          TEXT NOT NULL DEFAULT 'manual',        -- 'manual' | 'recurring'
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_purchases_cabin ON purchases(cabin_id);

    -- Faste utgifter som automatisk materialiseres til handlelista hver måned.
    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id               TEXT NOT NULL PRIMARY KEY,
      cabin_id         TEXT NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      title            TEXT NOT NULL,
      comment          TEXT,
      price            REAL,
      day_of_month     INTEGER NOT NULL DEFAULT 1,           -- 1..28
      active           INTEGER NOT NULL DEFAULT 1,
      last_generated   TEXT,                                 -- 'YYYY-MM'
      created_by       TEXT REFERENCES members(id) ON DELETE SET NULL,
      created_by_name  TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_recurring_cabin ON recurring_expenses(cabin_id);

    -- Vedlikehold. Alle medlemmer kan redigere.
    CREATE TABLE IF NOT EXISTS maintenance (
      id               TEXT NOT NULL PRIMARY KEY,
      cabin_id         TEXT NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      title            TEXT NOT NULL,
      description      TEXT,
      status           TEXT NOT NULL DEFAULT 'open',         -- 'open' | 'in_progress' | 'done'
      due_date         TEXT,
      created_by       TEXT REFERENCES members(id) ON DELETE SET NULL,
      created_by_name  TEXT NOT NULL,
      updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_cabin ON maintenance(cabin_id);

    -- Felles chat for alle medlemmer. Plain tekst, all historikk beholdes.
    CREATE TABLE IF NOT EXISTS chat_messages (
      id          TEXT NOT NULL PRIMARY KEY,
      member_id   TEXT REFERENCES members(id) ON DELETE SET NULL,
      member_name TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at);

    -- Hyttebok per hytte: markdown-innlegg med periode og hvem som var der.
    -- Bilder lagres på disk (/uploads) og refereres som URL i markdown-teksten (body).
    CREATE TABLE IF NOT EXISTS logbook_entries (
      id              TEXT NOT NULL PRIMARY KEY,
      cabin_id        TEXT NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      member_id       TEXT REFERENCES members(id) ON DELETE SET NULL,
      created_by_name TEXT NOT NULL,
      title           TEXT,
      period_from     TEXT,                                  -- 'YYYY-MM-DD'
      period_to       TEXT,                                  -- 'YYYY-MM-DD'
      participants    TEXT,                                  -- fritekst: hvem som var der
      body            TEXT NOT NULL,                         -- markdown
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_logbook_cabin ON logbook_entries(cabin_id);
  `);
}

function seed(database) {
  // Hytter — idempotent på unikt navn.
  const insertCabin = database.prepare(
    `INSERT INTO cabins (id, name, sort_order)
     SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM cabins WHERE name = ?)`
  );
  for (const c of CABINS) {
    insertCabin.run(randomUUID(), c.name, c.sort_order, c.name);
  }

  // Admin — fra env, med trygg fallback til eierens e-post.
  const adminEmail = (process.env.ADMIN_EMAIL || "jachrist2709@gmail.com").trim().toLowerCase();
  const adminName = (process.env.ADMIN_NAME || "Administrator").trim();
  database
    .prepare(
      `INSERT INTO members (id, email, name, role)
       SELECT ?, ?, ?, 'admin' WHERE NOT EXISTS (SELECT 1 FROM members WHERE email = ?)`
    )
    .run(randomUUID(), adminEmail, adminName, adminEmail);
}

module.exports = { getDb, query, queryOne, exec, withTx };
