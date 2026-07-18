const { app } = require("@azure/functions");
const { randomUUID } = require("node:crypto");
const { query, queryOne, exec } = require("../db");
const { json, error, withHandler } = require("../http");
const { requireAuth } = require("../auth");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 50000;

function cleanDate(v) {
  return DATE_RE.test(v || "") ? v : null;
}

// GET /api/cabins/{cabinId}/logbook — hytteboka for valgt hytte, nyeste først.
app.http("logbook-list", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "cabins/{cabinId}/logbook",
  handler: withHandler(async (request) => {
    await requireAuth(request);
    const rows = await query(
      `SELECT id, cabin_id, member_id, created_by_name, title, period_from, period_to,
              participants, body, created_at, updated_at
       FROM logbook_entries WHERE cabin_id = ?
       ORDER BY CASE WHEN period_from IS NULL THEN 1 ELSE 0 END, period_from ASC, created_at ASC`,
      [request.params.cabinId]
    );
    return json(rows);
  }),
});

// POST /api/cabins/{cabinId}/logbook  { period_from?, period_to?, participants?, body }
app.http("logbook-create", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "cabins/{cabinId}/logbook",
  handler: withHandler(async (request) => {
    const member = await requireAuth(request);
    const cabinId = request.params.cabinId;
    const data = (await request.json().catch(() => ({}))) || {};
    const title = String(data.title || "").trim();
    const body = String(data.body || "").trim();
    if (!title) return error(400, "Overskrift er påkrevd");
    if (title.length > 300) return error(400, "Overskriften er for lang");
    if (!body) return error(400, "Innlegget kan ikke være tomt");
    if (body.length > MAX_BODY) return error(400, "Innlegget er for langt");

    if (!(await queryOne("SELECT id FROM cabins WHERE id = ?", [cabinId]))) {
      return error(404, "Hytte ikke funnet");
    }
    const entry = {
      id: randomUUID(),
      cabin_id: cabinId,
      member_id: member.id,
      created_by_name: member.name,
      title,
      period_from: cleanDate(data.period_from),
      period_to: cleanDate(data.period_to),
      participants: data.participants ? String(data.participants).trim() : null,
      body,
    };
    await exec(
      `INSERT INTO logbook_entries
         (id, cabin_id, member_id, created_by_name, title, period_from, period_to, participants, body)
       VALUES (@id, @cabin_id, @member_id, @created_by_name, @title, @period_from, @period_to, @participants, @body)`,
      entry
    );
    return json(await queryOne("SELECT * FROM logbook_entries WHERE id = ?", [entry.id]), 201);
  }),
});

// PATCH /api/logbook/{id} — eier eller admin.
app.http("logbook-update", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "logbook/{id}",
  handler: withHandler(async (request) => {
    const member = await requireAuth(request);
    const id = request.params.id;
    const data = (await request.json().catch(() => ({}))) || {};
    const entry = await queryOne("SELECT member_id FROM logbook_entries WHERE id = ?", [id]);
    if (!entry) return error(404, "Innlegg ikke funnet");
    if (entry.member_id !== member.id && member.role !== "admin") {
      return error(403, "Bare den som skrev innlegget eller en administrator kan redigere");
    }

    if (data.title !== undefined) {
      const t = String(data.title).trim();
      if (!t) return error(400, "Overskrift er påkrevd");
      if (t.length > 300) return error(400, "Overskriften er for lang");
      await exec("UPDATE logbook_entries SET title = ? WHERE id = ?", [t, id]);
    }
    if (data.body !== undefined) {
      const b = String(data.body).trim();
      if (!b) return error(400, "Innlegget kan ikke være tomt");
      if (b.length > MAX_BODY) return error(400, "Innlegget er for langt");
      await exec("UPDATE logbook_entries SET body = ? WHERE id = ?", [b, id]);
    }
    if (data.period_from !== undefined) {
      await exec("UPDATE logbook_entries SET period_from = ? WHERE id = ?", [cleanDate(data.period_from), id]);
    }
    if (data.period_to !== undefined) {
      await exec("UPDATE logbook_entries SET period_to = ? WHERE id = ?", [cleanDate(data.period_to), id]);
    }
    if (data.participants !== undefined) {
      await exec("UPDATE logbook_entries SET participants = ? WHERE id = ?", [
        data.participants ? String(data.participants).trim() : null,
        id,
      ]);
    }
    await exec("UPDATE logbook_entries SET updated_at = SYSUTCDATETIME() WHERE id = ?", [id]);
    return json(await queryOne("SELECT * FROM logbook_entries WHERE id = ?", [id]));
  }),
});

// DELETE /api/logbook/{id} — eier eller admin.
app.http("logbook-delete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "logbook/{id}",
  handler: withHandler(async (request) => {
    const member = await requireAuth(request);
    const entry = await queryOne("SELECT member_id FROM logbook_entries WHERE id = ?", [request.params.id]);
    if (!entry) return error(404, "Innlegg ikke funnet");
    if (entry.member_id !== member.id && member.role !== "admin") {
      return error(403, "Bare den som skrev innlegget eller en administrator kan slette");
    }
    await exec("DELETE FROM logbook_entries WHERE id = ?", [request.params.id]);
    return json({ ok: true });
  }),
});
