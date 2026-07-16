// SQLite-lag for Hytteportal.
//
// Bruker better-sqlite3 (synkront, raskt, enkelt). Databasefilen ligger på stien
// i miljøvariabelen SQLITE_DB_PATH. På Azure Functions er lokal disk flyktig, så
// i produksjon bør stien peke til en montert Azure Files-share (f.eks.
// /mounted-data/hytteportal.db) slik at dataene overlever restart/skalering.
// Se docs/arkitektur.md.

const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");

let db;

function getDb() {
  if (db) return db;

  const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, "..", "data", "hytteportal.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cabins (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      location   TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Fremtidige tabeller (bookinger, innkjøp, vedlikehold) legges til her etter hvert.
}

module.exports = { getDb };
