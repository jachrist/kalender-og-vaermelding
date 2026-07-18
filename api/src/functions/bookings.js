const { app } = require("@azure/functions");
const { randomUUID } = require("node:crypto");
const { query, queryOne, exec, withTx } = require("../db");
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
    await requireAuth(request);
    const cabinId = request.params.cabinId;
    const from = request.query.get("from");
    const to = request.query.get("to");

    let sql =
      "SELECT id, cabin_id, member_id, member_name, start_date, end_date, note, created_at FROM bookings WHERE cabin_id = ?";
    const args = [cabinId];
    if (from && to && validDate(from) && validDate(to)) {
      // Overlapp med [from, to]
      sql += " AND start_date <= ? AND end_date >= ?";
      args.push(to, from);
    } else {
      // Datoer lagres som 'YYYY-MM-DD'-strenger; sammenlign med dagens dato.
      sql += " AND end_date >= CONVERT(char(10), GETDATE(), 23)";
    }
    sql += " ORDER BY start_date";
    return json(await query(sql, args));
  }),
});

// POST /api/cabins/{cabinId}/bookings  { start_date, end_date, note? }
// First-come-first-serve: avvises ved overlapp med eksisterende reservasjon.
app.http("bookings-create", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "cabins/{cabinId}/bookings",
  handler: withHandler(async (request) => {
    const member = await requireAuth(request);
    const cabinId = request.params.cabinId;
    const body = (await request.json().catch(() => ({}))) || {};
    const start = String(body.start_date || "").trim();
    const end = String(body.end_date || "").trim();
    const note = body.note ? String(body.note).trim() : null;

    if (!validDate(start) || !validDate(end)) {
      return error(400, "Ugyldig dato. Bruk formatet YYYY-MM-DD.");
    }
    if (end < start) return error(400, "Sluttdato kan ikke være før startdato");

    if (!(await queryOne("SELECT id FROM cabins WHERE id = ?", [cabinId]))) {
      return error(404, "Hytte ikke funnet");
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

    // FCFS-overlappsjekk + insert i én serialiserbar transaksjon, med HOLDLOCK
    // slik at to samtidige forsøk ikke begge slipper forbi sjekken.
    const clash = await withTx(async (q) => {
      const rows = await q(
        `SELECT id, member_name, start_date, end_date FROM bookings WITH (UPDLOCK, HOLDLOCK)
         WHERE cabin_id = @cabin_id AND start_date <= @end_date AND end_date >= @start_date`,
        { cabin_id: cabinId, start_date: start, end_date: end }
      );
      if (rows[0]) return rows[0];
      await q(
        `INSERT INTO bookings (id, cabin_id, member_id, member_name, start_date, end_date, note)
         VALUES (@id, @cabin_id, @member_id, @member_name, @start_date, @end_date, @note)`,
        booking
      );
      return null;
    });

    if (clash) {
      return error(
        409,
        `Opptatt: ${clash.member_name} har reservert ${clash.start_date}–${clash.end_date}`
      );
    }
    return json(booking, 201);
  }),
});

// DELETE /api/bookings/{id} — eier eller admin kan slette.
app.http("bookings-delete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "bookings/{id}",
  handler: withHandler(async (request) => {
    const member = await requireAuth(request);
    const booking = await queryOne("SELECT member_id FROM bookings WHERE id = ?", [
      request.params.id,
    ]);
    if (!booking) return error(404, "Reservasjon ikke funnet");
    if (booking.member_id !== member.id && member.role !== "admin") {
      return error(403, "Bare den som reserverte eller en administrator kan slette");
    }
    await exec("DELETE FROM bookings WHERE id = ?", [request.params.id]);
    return json({ ok: true });
  }),
});
