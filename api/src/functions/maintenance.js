const { app } = require("@azure/functions");
const { randomUUID } = require("node:crypto");
const { getDb } = require("../db");
const { json, error, withHandler } = require("../http");
const { requireAuth } = require("../auth");

const STATUSES = ["open", "in_progress", "done"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/cabins/{cabinId}/maintenance — vedlikeholdsoppgaver for hytta.
app.http("maintenance-list", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "cabins/{cabinId}/maintenance",
  handler: withHandler(async (request) => {
    requireAuth(request);
    const rows = getDb()
      .prepare(
        `SELECT id, cabin_id, title, description, status, due_date,
                created_by, created_by_name, updated_at, created_at
         FROM maintenance WHERE cabin_id = ?
         ORDER BY CASE status WHEN 'done' THEN 1 ELSE 0 END, due_date IS NULL, due_date, created_at DESC`
      )
      .all(request.params.cabinId);
    return json(rows);
  }),
});

// POST /api/cabins/{cabinId}/maintenance  { title, description?, status?, due_date? }
app.http("maintenance-create", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "cabins/{cabinId}/maintenance",
  handler: withHandler(async (request) => {
    const member = requireAuth(request);
    const cabinId = request.params.cabinId;
    const body = (await request.json().catch(() => ({}))) || {};
    const title = String(body.title || "").trim();
    if (!title) return error(400, "Feltet 'title' er påkrevd");

    const db = getDb();
    if (!db.prepare("SELECT id FROM cabins WHERE id = ?").get(cabinId)) {
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
    db.prepare(
      `INSERT INTO maintenance (id, cabin_id, title, description, status, due_date, created_by, created_by_name)
       VALUES (@id, @cabin_id, @title, @description, @status, @due_date, @created_by, @created_by_name)`
    ).run(item);
    return json(db.prepare("SELECT * FROM maintenance WHERE id = ?").get(item.id), 201);
  }),
});

// PATCH /api/maintenance/{id} — alle medlemmer kan redigere.
app.http("maintenance-update", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "maintenance/{id}",
  handler: withHandler(async (request) => {
    requireAuth(request);
    const id = request.params.id;
    const body = (await request.json().catch(() => ({}))) || {};
    const db = getDb();
    if (!db.prepare("SELECT id FROM maintenance WHERE id = ?").get(id)) {
      return error(404, "Oppgave ikke funnet");
    }

    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (t) db.prepare("UPDATE maintenance SET title = ? WHERE id = ?").run(t, id);
    }
    if (body.description !== undefined) {
      db.prepare("UPDATE maintenance SET description = ? WHERE id = ?").run(
        body.description ? String(body.description).trim() : null,
        id
      );
    }
    if (body.status !== undefined && STATUSES.includes(body.status)) {
      db.prepare("UPDATE maintenance SET status = ? WHERE id = ?").run(body.status, id);
    }
    if (body.due_date !== undefined) {
      db.prepare("UPDATE maintenance SET due_date = ? WHERE id = ?").run(
        DATE_RE.test(body.due_date || "") ? body.due_date : null,
        id
      );
    }
    db.prepare("UPDATE maintenance SET updated_at = datetime('now') WHERE id = ?").run(id);
    return json(db.prepare("SELECT * FROM maintenance WHERE id = ?").get(id));
  }),
});

// DELETE /api/maintenance/{id} — alle medlemmer kan slette.
app.http("maintenance-delete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "maintenance/{id}",
  handler: withHandler(async (request) => {
    requireAuth(request);
    const info = getDb().prepare("DELETE FROM maintenance WHERE id = ?").run(request.params.id);
    if (info.changes === 0) return error(404, "Oppgave ikke funnet");
    return json({ ok: true });
  }),
});
