const { app } = require("@azure/functions");
const { queryOne } = require("../db");
const { json, error, withHandler } = require("../http");
const {
  createOtp,
  verifyOtp,
  issueToken,
  revokeToken,
  requireAuth,
  normalizeEmail,
} = require("../auth");
const { sendOtpEmail } = require("../mail");

// POST /api/auth/request-code  { email }
// Sender engangskode hvis e-posten er et registrert medlem.
app.http("auth-request-code", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/request-code",
  handler: withHandler(async (request, context) => {
    const { email } = (await request.json().catch(() => ({}))) || {};
    const e = normalizeEmail(email);
    if (!e) return error(400, "Feltet 'email' er påkrevd");

    const member = await queryOne("SELECT id FROM members WHERE email = ?", [e]);
    if (!member) {
      // Lukket familiegruppe — vær tydelig på at e-posten ikke er registrert.
      return error(404, "E-posten er ikke registrert. Kontakt en administrator.");
    }

    const code = await createOtp(e);
    await sendOtpEmail(e, code, context);
    return json({ ok: true, message: "Engangskode sendt" });
  }),
});

// POST /api/auth/verify  { email, code }  ->  { token, member }
app.http("auth-verify", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/verify",
  handler: withHandler(async (request) => {
    const { email, code } = (await request.json().catch(() => ({}))) || {};
    const e = normalizeEmail(email);
    if (!e || !code) return error(400, "Feltene 'email' og 'code' er påkrevd");

    const member = await queryOne(
      "SELECT id, email, name, role FROM members WHERE email = ?",
      [e]
    );
    if (!member) return error(404, "E-posten er ikke registrert");

    await verifyOtp(e, code); // kaster 401 ved feil
    const token = await issueToken(member.id);
    return json({ token, member });
  }),
});

// GET /api/auth/me  ->  innlogget medlem
app.http("auth-me", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "auth/me",
  handler: withHandler(async (request) => {
    const member = await requireAuth(request);
    return json({ member });
  }),
});

// POST /api/auth/logout
app.http("auth-logout", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/logout",
  handler: withHandler(async (request) => {
    const header = request.headers.get("authorization") || "";
    const token = header.replace(/^Bearer\s+/i, "").trim();
    await revokeToken(token);
    return json({ ok: true });
  }),
});
