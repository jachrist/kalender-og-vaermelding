// Bildeopplasting til Azure Blob Storage for Hytteboka.
//
// Bilder lastes opp til en container med offentlig blob-tilgang, og URL-en
// legges inn som ![](url) i markdown-teksten. Konfig via miljøvariabel:
//   BLOB_CONNECTION_STRING — tilkoblingsstreng til lagringskontoen
//   BLOB_CONTAINER         — (valgfritt) containernavn, standard 'hyttebok'
//
// Uten BLOB_CONNECTION_STRING er opplasting deaktivert (blobConfigured()=false).

const { BlobServiceClient } = require("@azure/storage-blob");
const { randomUUID } = require("node:crypto");

const CONTAINER = process.env.BLOB_CONTAINER || "hyttebok";
const EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

let containerPromise = null;

function blobConfigured() {
  return Boolean(process.env.BLOB_CONNECTION_STRING);
}

async function getContainer() {
  if (!containerPromise) {
    containerPromise = (async () => {
      const svc = BlobServiceClient.fromConnectionString(process.env.BLOB_CONNECTION_STRING);
      const container = svc.getContainerClient(CONTAINER);
      // access: 'blob' = anonym lesetilgang på blob-nivå (URL-ene kan vises i <img>).
      await container.createIfNotExists({ access: "blob" });
      return container;
    })().catch((err) => {
      containerPromise = null;
      throw err;
    });
  }
  return containerPromise;
}

async function uploadImage(buffer, contentType) {
  const ext = EXT[contentType];
  if (!ext) throw new Error("Ugyldig bildetype (kun JPEG, PNG, GIF, WebP)");
  const container = await getContainer();
  const name = `${randomUUID()}.${ext}`;
  const blob = container.getBlockBlobClient(name);
  await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: contentType } });
  return blob.url;
}

module.exports = { uploadImage, blobConfigured };
