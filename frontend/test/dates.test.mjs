import { test } from "node:test";
import assert from "node:assert/strict";
import { isoWeek, monthGrid, ymd } from "../js/dates.js";

function wk(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return isoWeek(new Date(y, m - 1, d));
}

test("ISO-ukenummer mot kjente verdier", () => {
  assert.equal(wk("2026-01-01"), 1); // torsdag -> uke 1
  assert.equal(wk("2026-01-05"), 2); // mandag -> uke 2
  assert.equal(wk("2020-12-31"), 53); // 2020 er 53-ukers år
  assert.equal(wk("2021-01-01"), 53); // tilhører 2020 uke 53
  assert.equal(wk("2019-12-30"), 1); // mandag -> uke 1 (2020)
});

test("monthGrid dekker måneden og starter på mandag", () => {
  const grid = monthGrid(2026, 6); // juli 2026
  assert.equal(ymd(grid[0].days[0].date), "2026-06-29"); // mandag før 1. juli
  assert.equal(grid[0].days[0].date.getDay(), 1); // mandag
  const alle = grid.flatMap((w) => w.days.map((d) => ymd(d.date)));
  for (let d = 1; d <= 31; d++) {
    const iso = `2026-07-${String(d).padStart(2, "0")}`;
    assert.ok(alle.includes(iso), `mangler ${iso}`);
  }
});
