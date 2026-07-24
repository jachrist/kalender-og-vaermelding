// Autentisering: engangskoder (OTP) og opake tokens.
//
// - OTP: 6-sifret kode, 10 min levetid. Lagres kun som SHA-256-hash.
// - Token: tilfeldig opak streng lagret som hash i 'tokens'-tabellen, 30 dagers
//   levetid. Klienten lagrer selve tokenet i localStorage og sender det som
//   'X-Access-Token' (eller 'Authorization: Bearer <token>').
//
// Datalaget (SQLite) eksponeres async, så alle funksjoner her er async.

const { randomUUID, randomBytes, createHash } = require("node:crypto");
const { query, queryOne, exec } = require("./db");
const { HttpError } = require("./http");

const OTP_TTL_MIN = 10;
const TOKEN_TTL_DAYS = 30;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sixDigitCode() {
  // 000000–999999, jevnt fordelt.
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// Oppretter og lagrer en OTP for e-posten. Returnerer klartekst-koden (til e-post).
async function createOtp(email) {
  const code = sixDigitCode();
  await exec(
    `INSERT INTO otp_codes (id, email, code_hash, expires_at)
     VALUES (?, ?, ?, datetime('now', '+${OTP_TTL_MIN} minutes'))`,
    [randomUUID(), normalizeEmail(email), sha256(code)]
  );
  return code;
}

// Verifiserer OTP. Ved suksess ryddes alle koder for e-posten. Kaster ved feil.
async function verifyOtp(email, code) {
  const e = normalizeEmail(email);
  const row = await queryOne(
    `SELECT id FROM otp_codes
     WHERE email = ? AND code_hash = ? AND expires_at > datetime('now')
     ORDER BY created_at DESC LIMIT 1`,
    [e, sha256(String(code || "").trim())]
  );
  if (!row) throw new HttpError(401, "Ugyldig eller utløpt kode");
  await exec("DELETE FROM otp_codes WHERE email = ?", [e]);
}

// Utsteder et token for et medlem og returnerer klartekst-tokenet.
async function issueToken(memberId) {
  const token = randomBytes(32).toString("base64url");
  await exec(
    `INSERT INTO tokens (token_hash, member_id, expires_at)
     VALUES (?, ?, datetime('now', '+${TOKEN_TTL_DAYS} days'))`,
    [sha256(token), memberId]
  );
  return token;
}

async function revokeToken(token) {
  if (!token) return;
  await exec("DELETE FROM tokens WHERE token_hash = ?", [sha256(token)]);
}

function bearerToken(request) {
  // Express: req.headers er et vanlig objekt med små bokstaver i nøklene.
  // Vi godtar både X-Access-Token og Authorization: Bearer (klienten sender
  // primært X-Access-Token av historiske grunner fra SWA-tiden).
  const custom = request.headers["x-access-token"];
  if (custom) return String(custom).trim();
  const header = request.headers["authorization"] || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// Returnerer innlogget medlem eller kaster 401.
async function requireAuth(request) {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, "Mangler token");
  const member = await queryOne(
    `SELECT m.id, m.email, m.name, m.role
     FROM tokens t JOIN members m ON m.id = t.member_id
     WHERE t.token_hash = ? AND t.expires_at > datetime('now')`,
    [sha256(token)]
  );
  if (!member) throw new HttpError(401, "Ugyldig eller utløpt token");
  return member;
}

async function requireAdmin(request) {
  const member = await requireAuth(request);
  if (member.role !== "admin") throw new HttpError(403, "Krever administrator");
  return member;
}

module.exports = {
  createOtp,
  verifyOtp,
  issueToken,
  revokeToken,
  requireAuth,
  requireAdmin,
  normalizeEmail,
  bearerToken,
};
