# Hytteportal

PWA for å administrere og planlegge **bruk, innkjøp og vedlikehold** av fire hytter
som familien eier sammen.

> Repoet heter foreløpig `kalender-og-vaermelding`, men prosjektet er hytteportalen.
> Repoet kan gis nytt navn til `hytteportal` på github.com når som helst — historikken beholdes.

## Hyttene

Gartha rød · Gartha hvit · Gartha anneks · Skeikampen
(seedes automatisk i databasen ved første oppstart).

## Funksjoner

- **📅 Bruk** — reservasjon på døgnbasis i en månedskalender per hytte (med ukenummer,
  dag og dato). First-come-first-serve: opptatte dager sperres. Den som reserverte —
  eller en administrator — kan slette en reservasjon.
- **🛒 Innkjøp** — handleliste med pris og kommentar. Den som la inn varen kan redigere
  og slette; alle kan huke av for «kjøpt». **Faste utgifter** legges automatisk inn i
  handlelista hver måned (materialiseres av en timer-funksjon i API-et).
- **🔧 Vedlikehold** — oppgaveliste med status (åpen/pågår/ferdig) og frist. Alle
  medlemmer kan opprette, redigere og slette.
- **📖 Hyttebok** — per hytte: innlegg med periode (fra–til) og hvem som var der,
  skrevet i en **markdown-editor** med opplasting og innliming av bilder (lagres i
  Azure Blob Storage). Eier eller admin kan redigere/slette.
- **💬 Chat** — felles chat for alle medlemmer, plain tekst. All historikk beholdes.
- **⚙️ Admin** — medlemsregister: legg til medlemmer med navn/e-post, sett rolle
  (medlem/administrator), fjern medlemmer.

Admin kan i tillegg **booke og redigere på vegne av andre** («Book for andre» med
medlemsvelger, og flytte/endre eksisterende reservasjoner).

## Innlogging

- Brukerregister med **navn og e-post**. Kun registrerte e-poster kan logge inn.
- Innlogging med **6-sifret engangskode** (10 min levetid) sendt på e-post.
- Ved verifisering utstedes et **token** som lagres i `localStorage` og sendes som
  `Authorization: Bearer …`. All tilgangskontroll håndheves **server-side**.
- Roller: `admin` og `member`. Første administrator seedes fra `ADMIN_EMAIL`.
- E-post sendes via **Microsoft Graph** (`sendMail`) på samme M365-tenant som Azure
  Functions kjører på (se miljøvariabler under). Uten Graph-konfig logges koden i
  stedet — praktisk for lokal utvikling.

## Teknisk stack

| Lag       | Teknologi                                                    |
|-----------|--------------------------------------------------------------|
| Frontend  | Ren HTML/CSS/JS PWA i browser — ingen rammeverk, ingen byggsteg |
| PWA       | `manifest.webmanifest` + service worker (`sw.js`), offline   |
| API       | Node på **Azure Functions** (v4 programmeringsmodell)        |
| Lagring   | **Azure SQL Database** (serverless) via `mssql`             |
| E-post    | Microsoft Graph `sendMail` (client credentials)              |

Se [`docs/arkitektur.md`](docs/arkitektur.md) for detaljer, datamodell og
oppsett av Azure SQL.

## Struktur

```
frontend/
  index.html               # App-skall (login + app)
  manifest.webmanifest     # PWA-manifest
  sw.js                    # Service worker (network-first + offline-fallback)
  css/style.css            # Globale stiler, dark/light
  js/
    app.js                 # Orkestrering: boot, faner, hyttevelger
    api.js                 # API-klient + token/økt (localStorage)
    auth.js                # Innloggingsflyt (e-post -> engangskode)
    dom.js                 # Små DOM-hjelpere (el, toast, kr)
    dates.js               # Dato/ISO-uke/månedsrutenett
    views/booking.js       # Kalender-booking
    views/purchases.js     # Handleliste + faste utgifter
    views/maintenance.js   # Vedlikehold
    views/admin.js         # Medlemsadministrasjon
  icons/                   # App-ikoner (se icons/README.md)

api/                       # Azure Functions (Node, v4-modell)
  host.json
  package.json
  local.settings.json.example
  src/
    db.js                  # Azure SQL-lag: pool, async query-hjelpere, skjema, seeding
    auth.js                # OTP + token + requireAuth/requireAdmin
    mail.js                # Microsoft Graph sendMail
    http.js                # Respons-hjelpere + feilhåndtering
    recurring.js           # Materialisering av faste utgifter
    functions/
      health.js            # GET  /api/health
      auth.js              # POST /api/auth/request-code | verify | me | logout
      members.js           # /api/members (admin)
      cabins.js            # GET  /api/cabins
      bookings.js          # /api/cabins/{id}/bookings, DELETE /api/bookings/{id}
      purchases.js         # /api/cabins/{id}/purchases, PATCH/DELETE /api/purchases/{id}
      recurring.js         # faste utgifter + timer + POST /api/recurring/run
      maintenance.js       # /api/cabins/{id}/maintenance

docs/arkitektur.md
```

## Utvikling lokalt

### API (Azure Functions)
Krever [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) og Node 18+.

```bash
cd api
npm install
cp local.settings.json.example local.settings.json   # fyll inn SQL_* + ADMIN_EMAIL m.m.
npm start                                             # func start -> http://localhost:7071
```

Lokal utvikling kobler mot en Azure SQL-database (samme som prod, eller en egen
dev-database). Fyll inn `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER` og `SQL_PASSWORD`
i `local.settings.json`, og åpne brannmuren i Azure SQL for din IP (Azure-portalen
→ SQL-server → *Networking*). Skjema og de fire hyttene opprettes automatisk ved
første oppstart. Uten Graph-variabler skrives engangskoden til konsollen i stedet
for e-post.

### Frontend
Server `frontend/` statisk:

```bash
cd frontend
python3 -m http.server 3000      # eller: npx serve .
```

`js/api.js` peker automatisk mot `http://localhost:7071/api` når du kjører på
localhost, og mot `/api` i produksjon.

## Miljøvariabler (API)

| Variabel               | Beskrivelse                                            |
|------------------------|--------------------------------------------------------|
| `SQL_SERVER`           | Azure SQL-server, f.eks. `hytteportal.database.windows.net` |
| `SQL_DATABASE`         | Databasenavn (standard `hytteportal`)                  |
| `SQL_USER`             | SQL-innlogging (bruker)                                 |
| `SQL_PASSWORD`         | SQL-passord                                            |
| `SQL_CONNECTION_STRING`| (valgfritt) hele tilkoblingsstrengen — overstyrer feltene over |
| `SQL_TRUST_CERT`       | (valgfritt) `true` kun for lokal SQL Server m/selvsignert sert |
| `BLOB_CONNECTION_STRING`| Tilkoblingsstreng til Azure Storage (bilder i Hytteboka)      |
| `BLOB_CONTAINER`       | (valgfritt) blob-container, standard `hyttebok`               |
| `ADMIN_EMAIL`          | E-post som seedes som første administrator             |
| `ADMIN_NAME`           | Visningsnavn for admin                                 |
| `TENANT_ID`            | M365 tenant (directory) ID for Graph                   |
| `GRAPH_CLIENT_ID`      | App registration (client) ID                           |
| `GRAPH_CLIENT_SECRET`  | Client secret                                          |
| `MAIL_SENDER`          | Avsender-postboks e-post/UPN                            |
| `MAIL_FROM_NAME`       | (valgfritt) visningsnavn på avsender                   |

## CI og deploy

To GitHub Actions-workflows i `.github/workflows/`:

- **`ci.yml`** — kjører ved hver push/PR: syntaks-sjekk av all JS, JSON-validering og
  testene (`node --test`). Krever ingen hemmeligheter — gir grønne haker med en gang.
- **`azure-static-web-apps.yml`** — deployer frontend + API til **Azure Static Web Apps**.

### Sette opp deploy (engangsjobb)

1. Opprett en **Static Web App** i Azure-portalen, velg **"Other"** som kilde (så Azure
   ikke lager sin egen workflow — vi bruker den som ligger i repoet).
2. Kopier deployment-token (SWA → *Manage deployment token*) og legg det inn som
   repo-secret **`AZURE_STATIC_WEB_APPS_API_TOKEN`**
   (GitHub → Settings → Secrets and variables → Actions).
3. Sett app-innstillinger i SWA (*Configuration*): `SQL_SERVER`, `SQL_DATABASE`,
   `SQL_USER`, `SQL_PASSWORD`, `BLOB_CONNECTION_STRING`, `ADMIN_EMAIL`, `TENANT_ID`,
   `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `MAIL_SENDER`.
4. Deploy skjer automatisk ved push til `main`, eller manuelt via **Run workflow**
   (workflow_dispatch) fra hvilken som helst branch. SWA ruter `/api/*` til Functions
   automatisk, så `API_BASE` blir `/api` uten ekstra konfig.

> ℹ️ **Persistens:** Data ligger nå i **Azure SQL Database**, ikke på funksjonens
> lokale disk. Dermed overlever alt (medlemmer, bookinger, innkjøp, vedlikehold)
> cold start og ny deploy — også på SWA sine managed functions. Opprett Azure
> SQL-databasen (serverless anbefales — auto-pauser når appen står stille) før
> første deploy, og pek `SQL_*`-innstillingene dit. Se `docs/arkitektur.md`.

## Status

Kjernefunksjonaliteten er på plass. Videre ønsker (varsling, utleggsoppgjør/hvem
skylder hvem, bildevedlegg til vedlikehold, kalendereksport) kan bygges på samme
mønster.
