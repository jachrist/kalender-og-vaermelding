// E-postutsending via Microsoft Graph (sendMail) på samme M365-tenant som
// Azure Functions kjører på.
//
// Autentisering: client credentials (app registration) med application-tillatelsen
// Mail.Send. Konfigureres via miljøvariabler:
//   TENANT_ID          — Directory (tenant) ID
//   GRAPH_CLIENT_ID    — App registration (client) ID
//   GRAPH_CLIENT_SECRET— Client secret
//   MAIL_SENDER        — Avsender-postboks (UPN/e-post) det sendes fra
//   MAIL_FROM_NAME     — (valgfritt) visningsnavn
//
// Hvis Graph-variablene ikke er satt, logges koden i stedet for å sendes.
// Da fungerer lokal utvikling uten hemmeligheter.

let cachedToken = null; // { value, expiresAt (ms) }

function graphConfigured() {
  return Boolean(
    process.env.TENANT_ID &&
      process.env.GRAPH_CLIENT_ID &&
      process.env.GRAPH_CLIENT_SECRET &&
      process.env.MAIL_SENDER
  );
}

async function getGraphToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }

  const url = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.GRAPH_CLIENT_ID,
    client_secret: process.env.GRAPH_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token-henting mot Entra ID feilet: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: now + (data.expires_in || 3600) * 1000,
  };
  return cachedToken.value;
}

async function sendMail({ to, subject, html, text }, context) {
  if (!graphConfigured()) {
    context?.warn?.(
      `[mail] Graph ikke konfigurert — e-post til ${to} ikke sendt. Emne: "${subject}". Tekst: ${text || ""}`
    );
    return { sent: false, reason: "not-configured" };
  }

  const token = await getGraphToken();
  const sender = process.env.MAIL_SENDER;
  const message = {
    message: {
      subject,
      body: { contentType: html ? "HTML" : "Text", content: html || text || "" },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: false,
  };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    }
  );
  if (!res.ok) {
    throw new Error(`Graph sendMail feilet: ${res.status} ${await res.text()}`);
  }
  return { sent: true };
}

async function sendOtpEmail(to, code, context) {
  const subject = "Innloggingskode til Hytteportal";
  const text = `Din engangskode er ${code}. Den er gyldig i 10 minutter.`;
  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#1c1e1a">
      <h2 style="color:#2f6f4f">Hytteportal</h2>
      <p>Din engangskode er:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
      <p style="color:#6b7168">Koden er gyldig i 10 minutter. Ignorer denne e-posten om du ikke ba om innlogging.</p>
    </div>`;
  return sendMail({ to, subject, html, text }, context);
}

module.exports = { sendMail, sendOtpEmail, graphConfigured };
