const { app } = require("@azure/functions");
const { randomUUID } = require("node:crypto");
const { query, queryOne, exec } = require("../db");
const { json, error, withHandler } = require("../http");
const { requireAuth } = require("../auth");

const MAX_LEN = 4000;

// GET /api/chat[?after=<ISO-tidspunkt>]
// Uten 'after': de siste 200 meldingene (kronologisk). Med 'after': alle
// meldinger nyere enn tidspunktet — brukes til polling av nye meldinger.
app.http("chat-list", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "chat",
  handler: withHandler(async (request) => {
    await requireAuth(request);
    const after = request.query.get("after");
    let rows;
    if (after) {
      rows = await query(
        `SELECT TOP 500 id, member_id, member_name, body, created_at
         FROM chat_messages WHERE created_at > CAST(? AS DATETIME2)
         ORDER BY created_at`,
        [after]
      );
    } else {
      rows = await query(
        `SELECT id, member_id, member_name, body, created_at FROM (
           SELECT TOP 200 id, member_id, member_name, body, created_at
           FROM chat_messages ORDER BY created_at DESC
         ) t ORDER BY created_at`
      );
    }
    return json(rows);
  }),
});

// POST /api/chat  { body }  — send melding (alle innloggede).
app.http("chat-create", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "chat",
  handler: withHandler(async (request) => {
    const member = await requireAuth(request);
    const data = (await request.json().catch(() => ({}))) || {};
    const body = String(data.body || "").trim();
    if (!body) return error(400, "Tom melding");
    if (body.length > MAX_LEN) return error(400, `Meldingen er for lang (maks ${MAX_LEN} tegn)`);

    const msg = {
      id: randomUUID(),
      member_id: member.id,
      member_name: member.name,
      body,
    };
    await exec(
      `INSERT INTO chat_messages (id, member_id, member_name, body)
       VALUES (@id, @member_id, @member_name, @body)`,
      msg
    );
    return json(await queryOne("SELECT id, member_id, member_name, body, created_at FROM chat_messages WHERE id = ?", [msg.id]), 201);
  }),
});
