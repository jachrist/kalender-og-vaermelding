// Bildelagring på disk for Hytteboka.
//
// Bilder lagres i UPLOAD_DIR og serveres statisk av Express under /uploads.
// URL-en (/uploads/<navn>) legges inn som ![](url) i markdown-teksten.
// På Azure App Service peker UPLOAD_DIR til den vedvarende /home-disken
// (f.eks. /home/data/uploads), slik at bildene overlever restart/deploy.

const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

const EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

function uploadsDir() {
  return process.env.UPLOAD_DIR || path.join(__dirname, "..", "data", "uploads");
}

// Lagrer et bilde og returnerer den offentlige URL-en (/uploads/<navn>).
async function saveImage(buffer, contentType) {
  const ext = EXT[contentType];
  if (!ext) throw new Error("Ugyldig bildetype (kun JPEG, PNG, GIF, WebP)");
  const dir = uploadsDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await fs.promises.writeFile(path.join(dir, name), buffer);
  return `/uploads/${name}`;
}

module.exports = { saveImage, uploadsDir };
