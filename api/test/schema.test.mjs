// DB-uavhengige logikktester for domeneinvariantene som håndheves i SQL.
//
// Etter migreringen til Azure SQL kjøres selve spørringene mot en ekte database
// (integrasjonstest, se README), men de underliggende predikatene — FCFS-overlapp
// og forfall av faste utgifter — er ren logikk vi kan verifisere uten en DB.
// Testene her speiler nøyaktig WHERE-betingelsene i src/functions/bookings.js og
// src/recurring.js, så et avvik i logikken fanges opp i CI uten hemmeligheter.
import { test } from "node:test";
import assert from "node:assert/strict";

// Speiler: WHERE cabin_id = ? AND start_date <= @end_date AND end_date >= @start_date
// (inklusive datointervaller som 'YYYY-MM-DD'-strenger).
function overlaps(existing, newStart, newEnd) {
  return existing.start_date <= newEnd && existing.end_date >= newStart;
}

// Speiler: WHERE active = 1 AND day_of_month <= @dayOfMonth
//          AND (last_generated IS NULL OR last_generated <> @month)
function isDue(expense, dayOfMonth, month) {
  return (
    expense.active === 1 &&
    expense.day_of_month <= dayOfMonth &&
    (expense.last_generated == null || expense.last_generated !== month)
  );
}

test("FCFS-overlappsjekk", () => {
  const booking = { start_date: "2026-07-10", end_date: "2026-07-14" };
  assert.equal(overlaps(booking, "2026-07-12", "2026-07-13"), true, "helt inni");
  assert.equal(overlaps(booking, "2026-07-14", "2026-07-16"), true, "tangerer slutt");
  assert.equal(overlaps(booking, "2026-07-08", "2026-07-10"), true, "tangerer start");
  assert.equal(overlaps(booking, "2026-07-01", "2026-07-31"), true, "omslutter");
  assert.equal(overlaps(booking, "2026-07-15", "2026-07-18"), false, "rett etter");
  assert.equal(overlaps(booking, "2026-07-05", "2026-07-09"), false, "rett før");
});

test("forfalte faste utgifter", () => {
  const expense = { active: 1, day_of_month: 1, last_generated: null };
  assert.equal(isDue(expense, 15, "2026-07"), true, "forfalt den 15.");
  assert.equal(isDue(expense, 0, "2026-07"), false, "ikke forfalt før dagen");

  const generated = { ...expense, last_generated: "2026-07" };
  assert.equal(isDue(generated, 15, "2026-07"), false, "ikke dobbeltgenerert samme måned");
  assert.equal(isDue(generated, 15, "2026-08"), true, "forfaller igjen ny måned");

  const inactive = { active: 0, day_of_month: 1, last_generated: null };
  assert.equal(isDue(inactive, 15, "2026-07"), false, "inaktiv genererer ikke");
});
