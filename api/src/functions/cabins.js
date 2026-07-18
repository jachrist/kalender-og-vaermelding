const { app } = require("@azure/functions");
const { query } = require("../db");
const { json, withHandler } = require("../http");
const { requireAuth } = require("../auth");

// GET /api/cabins — list de fire hyttene (krever innlogging).
app.http("cabins", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "cabins",
  handler: withHandler(async (request) => {
    await requireAuth(request);
    const rows = await query("SELECT id, name FROM cabins ORDER BY sort_order, name");
    return json(rows);
  }),
});
