// Faste utgifter: materialiserer aktive recurring_expenses til handlelista
// (purchases) én gang per måned, når månedens dag har passert day_of_month.
//
// Idempotent: hver fast utgift har 'last_generated' = 'YYYY-MM' for måneden den
// sist ble lagt inn, så den lages aldri dobbelt. Kalles fra timer-funksjonen
// (daglig) og kan trigges manuelt av admin.

const { randomUUID } = require("node:crypto");
const { getDb } = require("./db");

// now: Date — sendes inn slik at funksjonen er testbar/deterministisk.
function generateDueRecurring(now) {
  const db = getDb();
  const month = now.toISOString().slice(0, 7); // 'YYYY-MM'
  const dayOfMonth = now.getUTCDate();

  const due = db
    .prepare(
      `SELECT * FROM recurring_expenses
       WHERE active = 1
         AND day_of_month <= ?
         AND (last_generated IS NULL OR last_generated <> ?)`
    )
    .all(dayOfMonth, month);

  const insert = db.prepare(
    `INSERT INTO purchases (id, cabin_id, title, comment, price, created_by, created_by_name, source)
     VALUES (@id, @cabin_id, @title, @comment, @price, @created_by, @created_by_name, 'recurring')`
  );
  const markGenerated = db.prepare("UPDATE recurring_expenses SET last_generated = ? WHERE id = ?");

  const run = db.transaction(() => {
    for (const r of due) {
      insert.run({
        id: randomUUID(),
        cabin_id: r.cabin_id,
        title: r.title,
        comment: r.comment,
        price: r.price,
        created_by: r.created_by,
        created_by_name: r.created_by_name,
      });
      markGenerated.run(month, r.id);
    }
  });
  run();
  return due.length;
}

module.exports = { generateDueRecurring };
