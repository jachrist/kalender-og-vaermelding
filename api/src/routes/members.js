const router = require("express").Router();
const { randomUUID } = require("node:crypto");
const { query, queryOne, exec } = require("../db");
const { json, error, withHandler } = require("../http");
const { requireAuth, requireAdmin, normalizeEmail } = require("../auth");

// GET /api/members — alle innloggede kan se medlemslista.
router.get(
  "/members",
  withHandler(async (req) => {
    await requireAuth(req);
    const rows = await query(
      "SELECT id, email, name, role, created_at FROM members ORDER BY name"
    );
    return json(rows);
  })
);

// POST /api/members — legg til medlem (kun admin).  { email, name, role? }
router.post(
  "/members",
  withHandler(async (req) => {
    await requireAdmin(req);
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const name = String(body.name || "").trim();
    const role = body.role === "admin" ? "admin" : "member";
    if (!email || !name) return error(400, "Feltene 'email' og 'name' er påkrevd");

    if (await queryOne("SELECT id FROM members WHERE email = ?", [email])) {
      return error(409, "E-posten er allerede registrert");
    }
    const member = { id: randomUUID(), email, name, role };
    await exec(
      "INSERT INTO members (id, email, name, role) VALUES (@id, @email, @name, @role)",
      member
    );
    return json(member, 201);
  })
);

// PATCH /api/members/:id — endre navn/rolle (kun admin).
router.patch(
  "/members/:id",
  withHandler(async (req) => {
    await requireAdmin(req);
    const id = req.params.id;
    const body = req.body || {};
    const member = await queryOne("SELECT id FROM members WHERE id = ?", [id]);
    if (!member) return error(404, "Medlem ikke funnet");

    const name = body.name !== undefined ? String(body.name).trim() : undefined;
    const role = body.role !== undefined ? (body.role === "admin" ? "admin" : "member") : undefined;
    if (name) await exec("UPDATE members SET name = ? WHERE id = ?", [name, id]);
    if (role) await exec("UPDATE members SET role = ? WHERE id = ?", [role, id]);

    return json(await queryOne("SELECT id, email, name, role FROM members WHERE id = ?", [id]));
  })
);

// DELETE /api/members/:id — fjern medlem (kun admin, ikke seg selv).
router.delete(
  "/members/:id",
  withHandler(async (req) => {
    const admin = await requireAdmin(req);
    const id = req.params.id;
    if (id === admin.id) return error(400, "Du kan ikke slette din egen bruker");
    const changes = await exec("DELETE FROM members WHERE id = ?", [id]);
    if (changes === 0) return error(404, "Medlem ikke funnet");
    return json({ ok: true });
  })
);

module.exports = router;
