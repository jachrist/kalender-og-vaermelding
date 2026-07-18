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

    // Admin kan reservere på vegne av et annet medlem ("Book for andre").
    let onBehalf = { id: member.id, name: member.name };
    if (body.member_id && body.member_id !== member.id) {
      if (member.role !== "admin") {
        return error(403, "Bare en administrator kan reservere for andre");
      }
      const target = await queryOne("SELECT id, name FROM members WHERE id = ?", [body.member_id]);
      if (!target) return error(400, "Ukjent medlem");
      onBehalf = { id: target.id, name: target.name };
    }

    const booking = {
      id: randomUUID(),
      cabin_id: cabinId,
      member_id: onBehalf.id,
      member_name: onBehalf.name,
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

// PATCH /api/bookings/{id} — eier eller admin kan endre datoer/notat.
// Admin kan i tillegg flytte reservasjonen til et annet medlem (member_id).
app.http("bookings-update", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "bookings/{id}",
  handler: withHandler(async (request) => {
    const member = await requireAuth(request);
    const id = request.params.id;
    const body = (await request.json().catch(() => ({}))) || {};

    const existing = await queryOne("SELECT * FROM bookings WHERE id = ?", [id]);
    if (!existing) return error(404, "Reservasjon ikke funnet");
    if (existing.member_id !== member.id && member.role !== "admin") {
      return error(403, "Bare den som reserverte eller en administrator kan endre");
    }

    let start = existing.start_date;
    let end = existing.end_date;
    let note = existing.note;
    let memberId = existing.member_id;
    let memberName = existing.member_name;

    if (body.start_date !== undefined) {
      start = String(body.start_date).trim();
      if (!validDate(start)) return error(400, "Ugyldig startdato");
    }
    if (body.end_date !== undefined) {
      end = String(body.end_date).trim();
      if (!validDate(end)) return error(400, "Ugyldig sluttdato");
    }
    if (end < start) return error(400, "Sluttdato kan ikke være før startdato");
    if (body.note !== undefined) note = body.note ? String(body.note).trim() : null;

    if (body.member_id !== undefined && body.member_id !== existing.member_id) {
      if (member.role !== "admin") {
        return error(403, "Bare en administrator kan flytte reservasjonen til et annet medlem");
      }
      const target = await queryOne("SELECT id, name FROM members WHERE id = ?", [body.member_id]);
      if (!target) return error(400, "Ukjent medlem");
      memberId = target.id;
      memberName = target.name;
    }

    // Overlappsjekk (ekskl. denne reservasjonen) + oppdatering, atomisk.
    const clash = await withTx(async (q) => {
      const rows = await q(
        `SELECT id, member_name, start_date, end_date FROM bookings WITH (UPDLOCK, HOLDLOCK)
         WHERE cabin_id = @cabin_id AND id <> @id
           AND start_date <= @end_date AND end_date >= @start_date`,
        { cabin_id: existing.cabin_id, id, start_date: start, end_date: end }
      );
      if (rows[0]) return rows[0];
      await q(
        `UPDATE bookings SET member_id = @member_id, member_name = @member_name,
                start_date = @start_date, end_date = @end_date, note = @note
         WHERE id = @id`,
        { id, member_id: memberId, member_name: memberName, start_date: start, end_date: end, note }
      );
      return null;
    });

    if (clash) {
      return error(
        409,
        `Opptatt: ${clash.member_name} har reservert ${clash.start_date}–${clash.end_date}`
      );
    }
    return json(await queryOne("SELECT * FROM bookings WHERE id = ?", [id]));
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
