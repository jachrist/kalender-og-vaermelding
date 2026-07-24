// Faste utgifter: materialiserer aktive recurring_expenses til handlelista
// (purchases) én gang per måned, når månedens dag har passert day_of_month.
//
// Idempotent: hver fast utgift har 'last_generated' = 'YYYY-MM' for måneden den
// sist ble lagt inn, så den lages aldri dobbelt. Kalles ved oppstart + intervall
// (server.js) og kan trigges manuelt av admin.

const { randomUUID } = require("node:crypto");
const { withTx } = require("./db");

// now: Date — sendes inn slik at funksjonen er testbar/deterministisk.
// Kjøres i én transaksjon: velg forfalte, sett inn i purchases og merk generert.
async function generateDueRecurring(now) {
  const month = now.toISOString().slice(0, 7); // 'YYYY-MM'
  const dayOfMonth = now.getUTCDate();

  return withTx(async (q) => {
    const due = await q(
      `SELECT * FROM recurring_expenses
       WHERE active = 1
         AND day_of_month <= @dayOfMonth
         AND (last_generated IS NULL OR last_generated <> @month)`,
      { dayOfMonth, month }
    );

    for (const r of due) {
      await q(
        `INSERT INTO purchases (id, cabin_id, title, comment, price, created_by, created_by_name, source)
         VALUES (@id, @cabin_id, @title, @comment, @price, @created_by, @created_by_name, 'recurring')`,
        {
          id: randomUUID(),
          cabin_id: r.cabin_id,
          title: r.title,
          comment: r.comment,
          price: r.price,
          created_by: r.created_by,
          created_by_name: r.created_by_name,
        }
      );
      await q("UPDATE recurring_expenses SET last_generated = @month WHERE id = @id", {
        month,
        id: r.id,
      });
    }
    return due.length;
  });
}

module.exports = { generateDueRecurring };
