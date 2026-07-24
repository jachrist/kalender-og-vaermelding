const router = require("express").Router();
const { randomUUID } = require("node:crypto");
const { query, queryOne, exec } = require("../db");
const { json, error, withHandler } = require("../http");
const { requireAuth } = require("../auth");

const STATUSES = ["open", "in_progress", "done"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/cabins/:cabinId/maintenance — vedlikeholdsoppgaver for hytta.
router.get(
  "/cabins/:cabinId/maintenance",
  withHandler(async (req) => {
    await requireAuth(req);
    const rows = await query(
      `SELECT id, cabin_id, title, description, status, due_date,
              created_by, created_by_name, updated_at, created_at
       FROM maintenance WHERE cabin_id = ?
       ORDER BY CASE status WHEN 'done' THEN 1 ELSE 0 END,
                CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, created_at DESC`,
      [req.params.cabinId]
    );
    return json(rows);
  })
);

// POST /api/cabins/:cabinId/maintenance  { title, description?, status?, due_date? }
router.post(
  "/cabins/:cabinId/maintenance",
  withHandler(async (req) => {
    const member = await requireAuth(req);
    const cabinId = req.params.cabinId;
    const body = req.body || {};
    const title = String(body.title || "").trim();
    if (!title) return error(400, "Feltet 'title' er påkrevd");

    if (!(await queryOne("SELECT id FROM cabins WHERE id = ?", [cabinId]))) {
      return error(404, "Hytte ikke funnet");
    }
    const status = STATUSES.includes(body.status) ? body.status : "open";
    const dueDate = DATE_RE.test(body.due_date || "") ? body.due_date : null;

    const item = {
      id: randomUUID(),
      cabin_id: cabinId,
      title,
      description: body.description ? String(body.description).trim() : null,
      status,
      due_date: dueDate,
      created_by: member.id,
      created_by_name: member.name,
    };
    await exec(
      `INSERT INTO maintenance (id, cabin_id, title, description, status, due_date, created_by, created_by_name)
       VALUES (@id, @cabin_id, @title, @description, @status, @due_date, @created_by, @created_by_name)`,
      item
    );
    return json(await queryOne("SELECT * FROM maintenance WHERE id = ?", [item.id]), 201);
  })
);

// PATCH /api/maintenance/:id — alle medlemmer kan redigere.
router.patch(
  "/maintenance/:id",
  withHandler(async (req) => {
    await requireAuth(req);
    const id = req.params.id;
    const body = req.body || {};
    if (!(await queryOne("SELECT id FROM maintenance WHERE id = ?", [id]))) {
      return error(404, "Oppgave ikke funnet");
    }

    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (t) await exec("UPDATE maintenance SET title = ? WHERE id = ?", [t, id]);
    }
    if (body.description !== undefined) {
      await exec("UPDATE maintenance SET description = ? WHERE id = ?", [
        body.description ? String(body.description).trim() : null,
        id,
      ]);
    }
    if (body.status !== undefined && STATUSES.includes(body.status)) {
      await exec("UPDATE maintenance SET status = ? WHERE id = ?", [body.status, id]);
    }
    if (body.due_date !== undefined) {
      await exec("UPDATE maintenance SET due_date = ? WHERE id = ?", [
        DATE_RE.test(body.due_date || "") ? body.due_date : null,
        id,
      ]);
    }
    await exec("UPDATE maintenance SET updated_at = datetime('now') WHERE id = ?", [id]);
    return json(await queryOne("SELECT * FROM maintenance WHERE id = ?", [id]));
  })
);

// DELETE /api/maintenance/:id — alle medlemmer kan slette.
router.delete(
  "/maintenance/:id",
  withHandler(async (req) => {
    await requireAuth(req);
    const changes = await exec("DELETE FROM maintenance WHERE id = ?", [req.params.id]);
    if (changes === 0) return error(404, "Oppgave ikke funnet");
    return json({ ok: true });
  })
);

module.exports = router;
