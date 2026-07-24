// Hytteportal — Node/Express-server.
//
// Serverer den statiske frontend-en, /api/* og /uploads/* fra samme prosess.
// SQLite-filen og opplastede bilder ligger på stiene i SQLITE_DB_PATH og
// UPLOAD_DIR; på Azure App Service peker de til den vedvarende /home-disken
// (f.eks. /home/data/...), slik at data og bilder overlever restart/deploy.

// Last .env lokalt hvis den finnes (valgfritt i produksjon).
try {
  require("dotenv").config();
} catch {
  /* dotenv ikke installert — kjør på ekte miljøvariabler */
}

const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const routes = require("./src/routes");
const { uploadsDir } = require("./src/storage");
const { generateDueRecurring } = require("./src/recurring");

const app = express();

// JSON for alle ruter unntatt /api/uploads (som leser rå bytes selv).
app.use((req, res, next) => {
  if (req.path === "/api/uploads") return next();
  return express.json({ limit: "1mb" })(req, res, next);
});

// API
app.use("/api", routes);

// Opplastede bilder (Hyttebok)
app.use("/uploads", express.static(uploadsDir()));

// Statisk frontend. Ved deploy til App Service buntes frontend inn i app-roten
// (api/frontend); lokalt ligger den som søsken (../frontend).
const bundledFrontend = path.join(__dirname, "frontend");
const FRONTEND_DIR = fs.existsSync(bundledFrontend)
  ? bundledFrontend
  : path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR));

// SPA-fallback: alt som ikke er /api, /uploads eller en eksisterende fil -> index.html.
app.get("*", (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

// Faste utgifter: materialiser forfalte utgifter ved oppstart og hver 6. time.
// Idempotent (last_generated-guard i recurring.js). Erstatter timer-triggeren.
async function runRecurring() {
  try {
    const n = await generateDueRecurring(new Date());
    if (n) console.log(`[recurring] materialiserte ${n} faste utgifter`);
  } catch (err) {
    console.error("[recurring] feilet:", err);
  }
}
runRecurring();
setInterval(runRecurring, 6 * 60 * 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Hytteportal kjører på http://localhost:${PORT}`));

module.exports = app;
