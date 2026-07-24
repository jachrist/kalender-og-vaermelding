const router = require("express").Router();
const { randomUUID } = require("node:crypto");
const { query, queryOne, exec } = require("../db");
const { json, error, withHandler } = require("../http");
const { requireAuth, requireAdmin } = require("../auth");
const { generateDueRecurring } = require("../recurring");

function parsePrice(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampDay(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.min(28, Math.max(1, n)); // 1..28 for å unngå korte måneder
}

// GET /api/cabins/:cabinId/recurring — faste utgifter for hytta.
router.get(
  "/cabins/:cabinId/recurring",
  withHandler(async (req) => {
    await requireAuth(req);
    const rows = await query(
      `SELECT id, cabin_id, title, comment, price, day_of_month, active,
              last_generated, created_by, created_by_name, created_at
       FROM recurring_expenses WHERE cabin_id = ? ORDER BY day_of_month, title`,
      [req.params.cabinId]
    );
    return json(rows);
  })
);

// POST /api/cabins/:cabinId/recurring  { title, comment?, price?, day_of_month? }
router.post(
  "/cabins/:cabinId/recurring",
  withHandler(async (req) => {
    const member = await requireAuth(req);
    const cabinId = req.params.cabinId;
    const body = req.body || {};
    const title = String(body.title || "").trim();
    if (!title) return error(400, "Feltet 'title' er påkrevd");

    if (!(await queryOne("SELECT id FROM cabins WHERE id = ?", [cabinId]))) {
      return error(404, "Hytte ikke funnet");
    }
    const item = {
      id: randomUUID(),
      cabin_id: cabinId,
      title,
      comment: body.comment ? String(body.comment).trim() : null,
      price: parsePrice(body.price),
      day_of_month: clampDay(body.day_of_month ?? 1),
      created_by: member.id,
      created_by_name: member.name,
    };
    await exec(
      `INSERT INTO recurring_expenses
         (id, cabin_id, title, comment, price, day_of_month, created_by, created_by_name)
       VALUES (@id, @cabin_id, @title, @comment, @price, @day_of_month, @created_by, @created_by_name)`,
      item
    );
    return json(await queryOne("SELECT * FROM recurring_expenses WHERE id = ?", [item.id]), 201);
  })
);

// POST /api/recurring/run — kjør materialisering manuelt (kun admin).
router.post(
  "/recurring/run",
  withHandler(async (req) => {
    await requireAdmin(req);
    const count = await generateDueRecurring(new Date());
    return json({ ok: true, generated: count });
  })
);

// PATCH /api/recurring/:id — eier eller admin.
router.patch(
  "/recurring/:id",
  withHandler(async (req) => {
    const member = await requireAuth(req);
    const id = req.params.id;
    const body = req.body || {};
    const item = await queryOne("SELECT created_by FROM recurring_expenses WHERE id = ?", [id]);
    if (!item) return error(404, "Fast utgift ikke funnet");
    if (item.created_by !== member.id && member.role !== "admin") {
      return error(403, "Bare den som la inn utgiften eller en administrator kan redigere");
    }

    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (t) await exec("UPDATE recurring_expenses SET title = ? WHERE id = ?", [t, id]);
    }
    if (body.comment !== undefined) {
      await exec("UPDATE recurring_expenses SET comment = ? WHERE id = ?", [
        body.comment ? String(body.comment).trim() : null,
        id,
      ]);
    }
    if (body.price !== undefined) {
      await exec("UPDATE recurring_expenses SET price = ? WHERE id = ?", [parsePrice(body.price), id]);
    }
    if (body.day_of_month !== undefined) {
      await exec("UPDATE recurring_expenses SET day_of_month = ? WHERE id = ?", [
        clampDay(body.day_of_month),
        id,
      ]);
    }
    if (body.active !== undefined) {
      await exec("UPDATE recurring_expenses SET active = ? WHERE id = ?", [body.active ? 1 : 0, id]);
    }
    return json(await queryOne("SELECT * FROM recurring_expenses WHERE id = ?", [id]));
  })
);

// DELETE /api/recurring/:id — eier eller admin.
router.delete(
  "/recurring/:id",
  withHandler(async (req) => {
    const member = await requireAuth(req);
    const item = await queryOne("SELECT created_by FROM recurring_expenses WHERE id = ?", [
      req.params.id,
    ]);
    if (!item) return error(404, "Fast utgift ikke funnet");
    if (item.created_by !== member.id && member.role !== "admin") {
      return error(403, "Bare den som la inn utgiften eller en administrator kan slette");
    }
    await exec("DELETE FROM recurring_expenses WHERE id = ?", [req.params.id]);
    return json({ ok: true });
  })
);

module.exports = router;
