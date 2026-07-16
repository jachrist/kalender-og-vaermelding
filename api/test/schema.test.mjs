// Verifiserer at SQL-skjemaet i db.js er gyldig og at FCFS-overlapp og
// forfalte faste utgifter oppfører seg riktig. Bruker node:sqlite (innebygd)
// slik at testen ikke krever at better-sqlite3 er installert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dbSrc = readFileSync(fileURLToPath(new URL("../src/db.js", import.meta.url)), "utf8");
const schema = dbSrc.split("db.exec(`")[1].split("`)")[0];

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  db.exec("INSERT INTO cabins (id,name,sort_order) VALUES ('c1','Gartha rød',1)");
  db.exec("INSERT INTO members (id,email,name,role) VALUES ('m1','a@b.no','Ola','member')");
  return db;
}

test("skjemaet opprettes uten feil", () => {
  assert.doesNotThrow(() => freshDb());
});

test("FCFS-overlappsjekk", () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO bookings (id,cabin_id,member_id,member_name,start_date,end_date) VALUES (?,?,?,?,?,?)"
  ).run("b1", "c1", "m1", "Ola", "2026-07-10", "2026-07-14");

  const clash = db.prepare(
    "SELECT id FROM bookings WHERE cabin_id=? AND start_date<=? AND end_date>=? LIMIT 1"
  );
  const overlaps = (s, e) => !!clash.get("c1", e, s);

  assert.equal(overlaps("2026-07-12", "2026-07-13"), true, "helt inni");
  assert.equal(overlaps("2026-07-14", "2026-07-16"), true, "tangerer slutt");
  assert.equal(overlaps("2026-07-08", "2026-07-10"), true, "tangerer start");
  assert.equal(overlaps("2026-07-01", "2026-07-31"), true, "omslutter");
  assert.equal(overlaps("2026-07-15", "2026-07-18"), false, "rett etter");
  assert.equal(overlaps("2026-07-05", "2026-07-09"), false, "rett før");
});

test("forfalte faste utgifter", () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO recurring_expenses (id,cabin_id,title,day_of_month,created_by_name) VALUES (?,?,?,?,?)"
  ).run("r1", "c1", "Strøm", 1, "Ola");

  const due = db.prepare(
    "SELECT count(*) AS n FROM recurring_expenses WHERE active=1 AND day_of_month<=? AND (last_generated IS NULL OR last_generated<>?)"
  );
  assert.equal(due.get(15, "2026-07").n, 1, "forfalt den 15.");
  assert.equal(due.get(0, "2026-07").n, 0, "ikke forfalt før dagen");

  db.prepare("UPDATE recurring_expenses SET last_generated='2026-07' WHERE id='r1'").run();
  assert.equal(due.get(15, "2026-07").n, 0, "ikke dobbeltgenerert samme måned");
});
