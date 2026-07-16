const { app } = require("@azure/functions");
const { randomUUID } = require("node:crypto");
const { getDb } = require("../db");

// GET  /api/cabins — list alle hytter
// POST /api/cabins — opprett en hytte  { name, location? }
//
// Eksempel-endepunkt som viser mønsteret. Bookinger, innkjøp og vedlikehold
// bygges ut på samme måte når kravene er beskrevet nærmere.
app.http("cabins", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "cabins",
  handler: async (request, context) => {
    const db = getDb();

    if (request.method === "GET") {
      const rows = db.prepare("SELECT id, name, location, created_at FROM cabins ORDER BY name").all();
      return { jsonBody: rows };
    }

    // POST
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Ugyldig JSON i request-body" } };
    }

    const name = (body?.name || "").trim();
    if (!name) {
      return { status: 400, jsonBody: { error: "Feltet 'name' er påkrevd" } };
    }

    const cabin = {
      id: randomUUID(),
      name,
      location: (body?.location || "").trim() || null,
    };
    db.prepare("INSERT INTO cabins (id, name, location) VALUES (@id, @name, @location)").run(cabin);
    context.log(`Opprettet hytte ${cabin.id} (${cabin.name})`);

    return { status: 201, jsonBody: cabin };
  },
});
