const express = require("express");
const router = express.Router();
const heicConvert = require("heic-convert");
const { json, error, withHandler } = require("../http");
const { requireAuth } = require("../auth");
const { saveImage } = require("../storage");

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB (HEIC fra telefon kan være store)
const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

// Rå binæropplasting: les hele kroppen som Buffer uansett Content-Type.
const rawBody = express.raw({ type: () => true, limit: "15mb" });

// POST /api/uploads — last opp et bilde (rå bytes, Content-Type: image/*).
// HEIC/HEIF (iPhone) konverteres automatisk til JPEG, siden nettlesere ikke kan
// vise HEIC. Returnerer { url } til det lagrede bildet. Krever innlogging.
router.post(
  "/uploads",
  rawBody,
  withHandler(async (req) => {
    await requireAuth(req);
    const contentType = String(req.headers["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    let buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buffer.length) return error(400, "Tomt bilde");
    if (buffer.length > MAX_BYTES) return error(413, "Bildet er for stort (maks 12 MB)");

    let type = contentType;
    if (HEIC_TYPES.has(contentType)) {
      try {
        buffer = Buffer.from(await heicConvert({ buffer, format: "JPEG", quality: 0.85 }));
        type = "image/jpeg";
      } catch (err) {
        return error(400, "Kunne ikke konvertere HEIC-bildet: " + err.message);
      }
    }

    try {
      const url = await saveImage(buffer, type);
      return json({ url }, 201);
    } catch (err) {
      return error(400, err.message);
    }
  })
);

module.exports = router;
