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
  `X-Access-Token` (eller `Authorization: Bearer …`). All tilgangskontroll håndheves
  **server-side**.
- Roller: `admin` og `member`. Første administrator seedes fra `ADMIN_EMAIL`.
- E-post sendes via **Microsoft Graph** (`sendMail`) på en M365-tenant (se
  miljøvariabler under). Uten Graph-konfig logges koden i stedet — praktisk for
  lokal utvikling.

## Teknisk stack

| Lag       | Teknologi                                                    |
|-----------|--------------------------------------------------------------|
| Frontend  | Ren HTML/CSS/JS PWA i browser — ingen rammeverk, ingen byggsteg |
| PWA       | `manifest.webmanifest` + service worker (`sw.js`), offline   |
| API       | Node med **Express** — serverer også den statiske frontend-en |
| Hosting   | **Azure App Service** (Linux, Node) — kjører fint på Free (F1) |
| Lagring   | **SQLite** via `better-sqlite3`, på App Service sin vedvarende `/home`-disk |
| Bilder    | Lagres på disk under `/uploads` (samme vedvarende `/home`-disk) |
| E-post    | Microsoft Graph `sendMail` (client credentials)              |

Se [`docs/arkitektur.md`](docs/arkitektur.md) for detaljer, datamodell og
persistens.

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
    views/logbook.js       # Hyttebok (markdown + bilder)
    views/chat.js          # Felles chat
    views/admin.js         # Medlemsadministrasjon
  icons/                   # App-ikoner (se icons/README.md)

api/                       # Node/Express-server
  server.js                # Express-app: serverer /api, /uploads og statisk frontend
  package.json
  .env.example
  src/
    db.js                  # SQLite-lag: async query/queryOne/exec/withTx, skjema, seeding
    auth.js                # OTP + token + requireAuth/requireAdmin
    mail.js                # Microsoft Graph sendMail
    storage.js             # Lagring av opplastede bilder på disk (/uploads)
    http.js                # Respons-hjelpere + feilhåndtering (withHandler)
    recurring.js           # Materialisering av faste utgifter
    routes/
      index.js             # Samler alle ruter under /api
      health.js            # GET  /api/health
      auth.js              # POST /api/auth/request-code | verify | me | logout
      members.js           # /api/members (admin)
      cabins.js            # GET  /api/cabins
      bookings.js          # /api/cabins/:id/bookings, PATCH/DELETE /api/bookings/:id
      purchases.js         # /api/cabins/:id/purchases, PATCH/DELETE /api/purchases/:id
      recurring.js         # faste utgifter + POST /api/recurring/run
      maintenance.js       # /api/cabins/:id/maintenance
      chat.js              # /api/chat
      logbook.js           # /api/cabins/:id/logbook, PATCH/DELETE /api/logbook/:id
      uploads.js           # POST /api/uploads (bilder)

docs/arkitektur.md
```

## Utvikling lokalt

Krever kun **Node 18+**. Én prosess serverer både API og frontend:

```bash
cd api
npm install
cp .env.example .env      # fyll inn ADMIN_EMAIL m.m.
npm start                 # -> http://localhost:3000
```

Åpne `http://localhost:3000`. `js/api.js` bruker alltid `/api` (samme origin).
SQLite-filen, de fire hyttene og admin opprettes automatisk ved første oppstart.
Uten Graph-variabler skrives engangskoden til **konsollen** i stedet for e-post.

## Miljøvariabler (API)

Settes i `.env` lokalt, eller som *Application settings* i App Service.

| Variabel               | Beskrivelse                                            |
|------------------------|--------------------------------------------------------|
| `PORT`                 | Port Express lytter på (App Service injiserer denne)   |
| `SQLITE_DB_PATH`       | Sti til SQLite-fil (prod: `/home/data/hytteportal.db`) |
| `UPLOAD_DIR`           | Katalog for opplastede bilder (prod: `/home/data/uploads`) |
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
- **`azure-app-service.yml`** — bygger `api/node_modules` og deployer til **Azure App Service**.

### Sette opp deploy (engangsjobb)

1. Opprett en **App Service** (Linux, runtime *Node 20 LTS*) — **Free (F1)** holder.
2. *Configuration → Application settings*: `SQLITE_DB_PATH=/home/data/hytteportal.db`,
   `UPLOAD_DIR=/home/data/uploads`, **`SCM_DO_BUILD_DURING_DEPLOYMENT=true`**,
   `ADMIN_EMAIL`, `ADMIN_NAME`, samt Graph-variablene.
3. *General settings → Startup Command*: `node server.js`.
4. Last ned publish profile (*Get publish profile*) og legg innholdet som repo-secret
   **`AZURE_WEBAPP_PUBLISH_PROFILE`**. Sett app-navnet i workflow-filen (`AZURE_WEBAPP_NAME`).
5. Deploy skjer ved push til `main`, eller manuelt via **Run workflow**. Workflowen
   deployer `api/`-mappa (med frontend buntet inn) og lar **Oryx** kjøre `npm install`
   på serveren — da bygges `better-sqlite3` for riktig Node-versjon (unngår ABI-feil).

> ✅ **Persistens:** App Service sin `/home`-disk er vedvarende (Azure Files-backet), så
> SQLite-filen og opplastede bilder overlever restart og deploy. F1 er én instans, og
> `better-sqlite3` serialiserer skriving — trygt ved denne trafikken. Bruker
> rollback-journal (`DELETE`), ikke WAL, siden WAL ikke fungerer på Azure Files.
>
> ⚠️ **Cold start:** F1 har ikke *Always On*, så appen sovner etter ~20 min inaktivitet
> og bruker noen sekunder på å våkne. Eget domene/SSL krever et betalt nivå. Se
> `docs/arkitektur.md`.

## Status

Kjernefunksjonaliteten er på plass. Videre ønsker (varsling, utleggsoppgjør/hvem
skylder hvem, bildevedlegg til vedlikehold, kalendereksport) kan bygges på samme
mønster.
