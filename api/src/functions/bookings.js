const { app } = require("@azure/functions");
const { randomUUID } = require("node:crypto");
const { getDb } = require("../db");
const { json, error, withHandler } = require("../http");
const { requireAuth } = require("../auth");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// GET /api/cabins/{cabinId}/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD
// Uten from/to returneres alle reservasjoner som ikke er avsluttet ennå.
app.http("bookings-list", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "cabins/{cabinId}/bookings",
  handler: withHandler(async (request) => {
    requireAuth(request);
    const cabinId = request.params.cabinId;
    const from = request.query.get("from");
    const to = request.query.get("to");
    const db = getDb();

    let sql =
      "SELECT id, cabin_id, member_id, member_name, start_date, end_date, note, created_at FROM bookings WHERE cabin_id = ?";
    const args = [cabinId];
    if (from && to && validDate(from) && validDate(to)) {
      // Overlapp med [from, to]
      sql += " AND start_date <= ? AND end_date >= ?";
      args.push(to, from);
    } else {
      sql += " AND end_date >= date('now')";
    }
    sql += " ORDER BY start_date";
    return json(db.prepare(sql).all(...args));
  }),
});

// POST /api/cabins/{cabinId}/bookings  { start_date, end_date, note? }
// First-come-first-serve: avvises ved overlapp med eksisterende reservasjon.
app.http("bookings-create", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "cabins/{cabinId}/bookings",
  handler: withHandler(async (request) => {
    const member = requireAuth(request);
    const cabinId = request.params.cabinId;
    const body = (await request.json().catch(() => ({}))) || {};
    const start = String(body.start_date || "").trim();
    const end = String(body.end_date || "").trim();
    const note = body.note ? String(body.note).trim() : null;

    if (!validDate(start) || !validDate(end)) {
      return error(400, "Ugyldig dato. Bruk formatet YYYY-MM-DD.");
    }
    if (end < start) return error(400, "Sluttdato kan ikke være før startdato");

    const db = getDb();
    if (!db.prepare("SELECT id FROM cabins WHERE id = ?").get(cabinId)) {
      return error(404, "Hytte ikke funnet");
    }

    // FCFS-overlappsjekk.
    const clash = db
      .prepare(
        `SELECT id, member_name, start_date, end_date FROM bookings
         WHERE cabin_id = ? AND start_date <= ? AND end_date >= ?
         LIMIT 1`
      )
      .get(cabinId, end, start);
    if (clash) {
      return error(
        409,
        `Opptatt: ${clash.member_name} har reservert ${clash.start_date}–${clash.end_date}`
      );
    }

    const booking = {
      id: randomUUID(),
      cabin_id: cabinId,
      member_id: member.id,
      member_name: member.name,
      start_date: start,
      end_date: end,
      note,
    };
    db.prepare(
      `INSERT INTO bookings (id, cabin_id, member_id, member_name, start_date, end_date, note)
       VALUES (@id, @cabin_id, @member_id, @member_name, @start_date, @end_date, @note)`
    ).run(booking);
    return json(booking, 201);
  }),
});

// DELETE /api/bookings/{id} — eier eller admin kan slette.
app.http("bookings-delete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "bookings/{id}",
  handler: withHandler(async (request) => {
    const member = requireAuth(request);
    const db = getDb();
    const booking = db.prepare("SELECT member_id FROM bookings WHERE id = ?").get(request.params.id);
    if (!booking) return error(404, "Reservasjon ikke funnet");
    if (booking.member_id !== member.id && member.role !== "admin") {
      return error(403, "Bare den som reserverte eller en administrator kan slette");
    }
    db.prepare("DELETE FROM bookings WHERE id = ?").run(request.params.id);
    return json({ ok: true });
  }),
});
