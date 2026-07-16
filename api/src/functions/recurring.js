const { app } = require("@azure/functions");
const { randomUUID } = require("node:crypto");
const { getDb } = require("../db");
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

// GET /api/cabins/{cabinId}/recurring — faste utgifter for hytta.
app.http("recurring-list", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "cabins/{cabinId}/recurring",
  handler: withHandler(async (request) => {
    requireAuth(request);
    const rows = getDb()
      .prepare(
        `SELECT id, cabin_id, title, comment, price, day_of_month, active,
                last_generated, created_by, created_by_name, created_at
         FROM recurring_expenses WHERE cabin_id = ? ORDER BY day_of_month, title`
      )
      .all(request.params.cabinId);
    return json(rows);
  }),
});

// POST /api/cabins/{cabinId}/recurring  { title, comment?, price?, day_of_month? }
app.http("recurring-create", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "cabins/{cabinId}/recurring",
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
    db.prepare(
      `INSERT INTO recurring_expenses
         (id, cabin_id, title, comment, price, day_of_month, created_by, created_by_name)
       VALUES (@id, @cabin_id, @title, @comment, @price, @day_of_month, @created_by, @created_by_name)`
    ).run(item);
    return json(db.prepare("SELECT * FROM recurring_expenses WHERE id = ?").get(item.id), 201);
  }),
});

// PATCH /api/recurring/{id} — eier eller admin.
app.http("recurring-update", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "recurring/{id}",
  handler: withHandler(async (request) => {
    const member = requireAuth(request);
    const id = request.params.id;
    const body = (await request.json().catch(() => ({}))) || {};
    const db = getDb();
    const item = db.prepare("SELECT created_by FROM recurring_expenses WHERE id = ?").get(id);
    if (!item) return error(404, "Fast utgift ikke funnet");
    if (item.created_by !== member.id && member.role !== "admin") {
      return error(403, "Bare den som la inn utgiften eller en administrator kan redigere");
    }

    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (t) db.prepare("UPDATE recurring_expenses SET title = ? WHERE id = ?").run(t, id);
    }
    if (body.comment !== undefined) {
      db.prepare("UPDATE recurring_expenses SET comment = ? WHERE id = ?").run(
        body.comment ? String(body.comment).trim() : null,
        id
      );
    }
    if (body.price !== undefined) {
      db.prepare("UPDATE recurring_expenses SET price = ? WHERE id = ?").run(parsePrice(body.price), id);
    }
    if (body.day_of_month !== undefined) {
      db.prepare("UPDATE recurring_expenses SET day_of_month = ? WHERE id = ?").run(
        clampDay(body.day_of_month),
        id
      );
    }
    if (body.active !== undefined) {
      db.prepare("UPDATE recurring_expenses SET active = ? WHERE id = ?").run(body.active ? 1 : 0, id);
    }
    return json(db.prepare("SELECT * FROM recurring_expenses WHERE id = ?").get(id));
  }),
});

// DELETE /api/recurring/{id} — eier eller admin.
app.http("recurring-delete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "recurring/{id}",
  handler: withHandler(async (request) => {
    const member = requireAuth(request);
    const db = getDb();
    const item = db.prepare("SELECT created_by FROM recurring_expenses WHERE id = ?").get(request.params.id);
    if (!item) return error(404, "Fast utgift ikke funnet");
    if (item.created_by !== member.id && member.role !== "admin") {
      return error(403, "Bare den som la inn utgiften eller en administrator kan slette");
    }
    db.prepare("DELETE FROM recurring_expenses WHERE id = ?").run(request.params.id);
    return json({ ok: true });
  }),
});

// POST /api/recurring/run — kjør materialisering manuelt (kun admin).
app.http("recurring-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "recurring/run",
  handler: withHandler(async (request) => {
    requireAdmin(request);
    const count = generateDueRecurring(new Date());
    return json({ ok: true, generated: count });
  }),
});

// Timer: kjør daglig kl. 06:00 og legg inn forfalte faste utgifter.
// NCRONTAB: sekund minutt time dag måned ukedag
app.timer("recurring-timer", {
  schedule: "0 0 6 * * *",
  handler: (myTimer, context) => {
    const count = generateDueRecurring(new Date());
    context.log(`[recurring] materialiserte ${count} faste utgifter`);
  },
});
