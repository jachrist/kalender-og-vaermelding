const router = require("express").Router();
const { queryOne } = require("../db");
const { json, error, withHandler } = require("../http");
const {
  createOtp,
  verifyOtp,
  issueToken,
  revokeToken,
  requireAuth,
  normalizeEmail,
  bearerToken,
} = require("../auth");
const { sendOtpEmail } = require("../mail");

// POST /api/auth/request-code  { email }
// Sender engangskode hvis e-posten er et registrert medlem.
router.post(
  "/auth/request-code",
  withHandler(async (req) => {
    const { email } = req.body || {};
    const e = normalizeEmail(email);
    if (!e) return error(400, "Feltet 'email' er påkrevd");

    const member = await queryOne("SELECT id FROM members WHERE email = ?", [e]);
    if (!member) {
      // Lukket familiegruppe — vær tydelig på at e-posten ikke er registrert.
      return error(404, "E-posten er ikke registrert. Kontakt en administrator.");
    }

    const code = await createOtp(e);
    await sendOtpEmail(e, code, console);
    return json({ ok: true, message: "Engangskode sendt" });
  })
);

// POST /api/auth/verify  { email, code }  ->  { token, member }
router.post(
  "/auth/verify",
  withHandler(async (req) => {
    const { email, code } = req.body || {};
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
  })
);

// GET /api/auth/me  ->  innlogget medlem
router.get(
  "/auth/me",
  withHandler(async (req) => {
    const member = await requireAuth(req);
    return json({ member });
  })
);

// POST /api/auth/logout
router.post(
  "/auth/logout",
  withHandler(async (req) => {
    await revokeToken(bearerToken(req));
    return json({ ok: true });
  })
);

module.exports = router;
