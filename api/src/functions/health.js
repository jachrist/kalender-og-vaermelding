const { app } = require("@azure/functions");
const { getDb } = require("../db");

// GET /api/health — enkel helsesjekk som også verifiserer at databasen svarer.
app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async () => {
    try {
      getDb().prepare("SELECT 1").get();
      return { jsonBody: { status: "ok", db: "ok" } };
    } catch (err) {
      return { status: 500, jsonBody: { status: "error", message: err.message } };
    }
  },
});
