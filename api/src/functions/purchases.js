const { app } = require("@azure/functions");
const { randomUUID } = require("node:crypto");
const { query, queryOne, exec } = require("../db");
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
    await requireAuth(request);
    const rows = await query(
      `SELECT id, cabin_id, title, comment, price, bought, bought_by_name, bought_at,
              created_by, created_by_name, source, created_at
       FROM purchases WHERE cabin_id = ?
       ORDER BY bought, created_at DESC`,
      [request.params.cabinId]
    );
    return json(rows);
  }),
});

// POST /api/cabins/{cabinId}/purchases  { title, comment?, price? }
app.http("purchases-create", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "cabins/{cabinId}/purchases",
  handler: withHandler(async (request) => {
    const member = await requireAuth(request);
    const cabinId = request.params.cabinId;
    const body = (await request.json().catch(() => ({}))) || {};
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
      created_by: member.id,
      created_by_name: member.name,
    };
    await exec(
      `INSERT INTO purchases (id, cabin_id, title, comment, price, created_by, created_by_name, source)
       VALUES (@id, @cabin_id, @title, @comment, @price, @created_by, @created_by_name, 'manual')`,
      item
    );
    return json(await queryOne("SELECT * FROM purchases WHERE id = ?", [item.id]), 201);
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
    const member = await requireAuth(request);
    const id = request.params.id;
    const body = (await request.json().catch(() => ({}))) || {};
    const item = await queryOne("SELECT * FROM purchases WHERE id = ?", [id]);
    if (!item) return error(404, "Vare ikke funnet");

    const isOwner = item.created_by === member.id || member.role === "admin";
    const wantsContentEdit =
      body.title !== undefined || body.comment !== undefined || body.price !== undefined;
    if (wantsContentEdit && !isOwner) {
      return error(403, "Bare den som la inn varen eller en administrator kan redigere");
    }

    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (t) await exec("UPDATE purchases SET title = ? WHERE id = ?", [t, id]);
    }
    if (body.comment !== undefined) {
      await exec("UPDATE purchases SET comment = ? WHERE id = ?", [
        body.comment ? String(body.comment).trim() : null,
        id,
      ]);
    }
    if (body.price !== undefined) {
      await exec("UPDATE purchases SET price = ? WHERE id = ?", [parsePrice(body.price), id]);
    }
    if (body.bought !== undefined) {
      const bought = body.bought ? 1 : 0;
      await exec(
        `UPDATE purchases SET bought = ?, bought_by_name = ?, bought_at = ? WHERE id = ?`,
        [bought, bought ? member.name : null, bought ? new Date() : null, id]
      );
    }
    return json(await queryOne("SELECT * FROM purchases WHERE id = ?", [id]));
  }),
});

// DELETE /api/purchases/{id} — eier eller admin.
app.http("purchases-delete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "purchases/{id}",
  handler: withHandler(async (request) => {
    const member = await requireAuth(request);
    const item = await queryOne("SELECT created_by FROM purchases WHERE id = ?", [
      request.params.id,
    ]);
    if (!item) return error(404, "Vare ikke funnet");
    if (item.created_by !== member.id && member.role !== "admin") {
      return error(403, "Bare den som la inn varen eller en administrator kan slette");
    }
    await exec("DELETE FROM purchases WHERE id = ?", [request.params.id]);
    return json({ ok: true });
  }),
});
