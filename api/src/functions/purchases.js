const { app } = require("@azure/functions");
const { randomUUID } = require("node:crypto");
const { getDb } = require("../db");
const { json, error, withHandler } = require("../http");
const { requireAuth } = require("../auth");

function parsePrice(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// GET /api/cabins/{cabinId}/purchases — handleliste for hytta.
app.http("purchases-list", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "cabins/{cabinId}/purchases",
  handler: withHandler(async (request) => {
    requireAuth(request);
    const rows = getDb()
      .prepare(
        `SELECT id, cabin_id, title, comment, price, bought, bought_by_name, bought_at,
                created_by, created_by_name, source, created_at
         FROM purchases WHERE cabin_id = ?
         ORDER BY bought, created_at DESC`
      )
      .all(request.params.cabinId);
    return json(rows);
  }),
});

// POST /api/cabins/{cabinId}/purchases  { title, comment?, price? }
app.http("purchases-create", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "cabins/{cabinId}/purchases",
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
      created_by: member.id,
      created_by_name: member.name,
    };
    db.prepare(
      `INSERT INTO purchases (id, cabin_id, title, comment, price, created_by, created_by_name, source)
       VALUES (@id, @cabin_id, @title, @comment, @price, @created_by, @created_by_name, 'manual')`
    ).run(item);
    return json(db.prepare("SELECT * FROM purchases WHERE id = ?").get(item.id), 201);
  }),
});

// PATCH /api/purchases/{id}
//  - 'bought' kan settes av alle innloggede.
//  - title/comment/price kan bare endres av eier eller admin.
app.http("purchases-update", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "purchases/{id}",
  handler: withHandler(async (request) => {
    const member = requireAuth(request);
    const id = request.params.id;
    const body = (await request.json().catch(() => ({}))) || {};
    const db = getDb();
    const item = db.prepare("SELECT * FROM purchases WHERE id = ?").get(id);
    if (!item) return error(404, "Vare ikke funnet");

    const isOwner = item.created_by === member.id || member.role === "admin";
    const wantsContentEdit =
      body.title !== undefined || body.comment !== undefined || body.price !== undefined;
    if (wantsContentEdit && !isOwner) {
      return error(403, "Bare den som la inn varen eller en administrator kan redigere");
    }

    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (t) db.prepare("UPDATE purchases SET title = ? WHERE id = ?").run(t, id);
    }
    if (body.comment !== undefined) {
      db.prepare("UPDATE purchases SET comment = ? WHERE id = ?").run(
        body.comment ? String(body.comment).trim() : null,
        id
      );
    }
    if (body.price !== undefined) {
      db.prepare("UPDATE purchases SET price = ? WHERE id = ?").run(parsePrice(body.price), id);
    }
    if (body.bought !== undefined) {
      const bought = body.bought ? 1 : 0;
      db.prepare(
        `UPDATE purchases
         SET bought = ?, bought_by_name = ?, bought_at = ?
         WHERE id = ?`
      ).run(bought, bought ? member.name : null, bought ? new Date().toISOString() : null, id);
    }
    return json(db.prepare("SELECT * FROM purchases WHERE id = ?").get(id));
  }),
});

// DELETE /api/purchases/{id} — eier eller admin.
app.http("purchases-delete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "purchases/{id}",
  handler: withHandler(async (request) => {
    const member = requireAuth(request);
    const db = getDb();
    const item = db.prepare("SELECT created_by FROM purchases WHERE id = ?").get(request.params.id);
    if (!item) return error(404, "Vare ikke funnet");
    if (item.created_by !== member.id && member.role !== "admin") {
      return error(403, "Bare den som la inn varen eller en administrator kan slette");
    }
    db.prepare("DELETE FROM purchases WHERE id = ?").run(request.params.id);
    return json({ ok: true });
  }),
});
