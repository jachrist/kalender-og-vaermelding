const { app } = require("@azure/functions");
const { json, error, withHandler } = require("../http");
const { requireAuth } = require("../auth");
const { uploadImage, blobConfigured } = require("../blob");

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

// POST /api/uploads — last opp et bilde (rå bytes, Content-Type: image/*).
// Returnerer { url } til det lagrede bildet. Krever innlogging.
app.http("uploads-image", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "uploads",
  handler: withHandler(async (request) => {
    await requireAuth(request);
    if (!blobConfigured()) {
      return error(503, "Bildeopplasting er ikke konfigurert på serveren");
    }
    const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const buffer = Buffer.from(await request.arrayBuffer());
    if (!buffer.length) return error(400, "Tomt bilde");
    if (buffer.length > MAX_BYTES) return error(413, "Bildet er for stort (maks 8 MB)");
    try {
      const url = await uploadImage(buffer, contentType);
      return json({ url }, 201);
    } catch (err) {
      return error(400, err.message);
    }
  }),
});
