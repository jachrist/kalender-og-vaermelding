# Arkitektur — Hytteportal

## Oversikt

```
┌────────────────────┐        HTTPS         ┌──────────────────────────┐
│  PWA (frontend/)    │  ───────────────►    │  Azure App Service        │
│  HTML/CSS/JS        │   /api/*, /uploads   │  Node + Express           │
│  Service worker     │  ◄───────────────    │  (server.js)              │
└────────────────────┘   statiske filer      └──────────┬───────────────┘
                                                         │
                                              ┌──────────▼───────────────┐
                                              │  /home (vedvarende disk)  │
                                              │  SQLite-fil + /uploads    │
                                              └───────────────────────────┘
```

- **Frontend** er en ren statisk PWA uten byggsteg, servert av Express (samme prosess).
- **API** er Node med Express (`server.js`), én rutefil per funksjonsområde under
  `api/src/routes/`. Samme prosess serverer `/api`, `/uploads` og de statiske filene.
- **Lagring** er **SQLite** via `better-sqlite3`. Datalaget er isolert i
  `api/src/db.js` bak et lite sett async-hjelpere (`query`, `queryOne`, `exec`,
  `withTx`) — så et framtidig bytte påvirker i hovedsak bare den fila og SQL-dialekten.

## App Service + SQLite — persistens

Databasefilen (`SQLITE_DB_PATH`) og opplastede bilder (`UPLOAD_DIR`) legges på App
Service sin **`/home`-disk**, som er vedvarende (Azure Files-backet). Dermed overlever
alt (medlemmer, bookinger, innkjøp, vedlikehold, hyttebok, chat, bilder) restart og
deploy. Kjører fint på **Free (F1)**-nivået.

Oppsett (engangs):
- Opprett App Service (Linux, Node 20). Startup Command: `node api/server.js`.
- App settings: `SQLITE_DB_PATH=/home/data/hytteportal.db`,
  `UPLOAD_DIR=/home/data/uploads`, `ADMIN_EMAIL`, samt Graph-variablene for e-post.
- Skjema og seeding (fire hytter + admin fra `ADMIN_EMAIL`) kjøres idempotent ved
  første oppstart — ingen manuell migrering nødvendig.

Viktige hensyn:
- **Samtidighet.** F1 er én instans, og `better-sqlite3` er synkront og serialiserer
  skriving. Kritiske lese-så-skrive-operasjoner (FCFS-booking og materialisering av
  faste utgifter) kjøres i en `BEGIN IMMEDIATE`-transaksjon (`withTx` i `db.js`).
  WAL-modus er på. SQLite på `/home` (nettverksmontert) frarådes ved høy
  skrive-samtidighet, men er trygt ved denne trafikken.
- **Cold start.** F1 mangler *Always On* og sovner etter ~20 min inaktivitet; første
  forespørsel deretter bruker noen sekunder på å starte Node på nytt.
- **Backup.** SQLite er én fil — ta en periodisk kopi av `/home/data/` (f.eks. via en
  scheduled WebJob eller ekstern sync) om dataene skal sikres utover App Service.

## Datamodell

Se `api/src/db.js` for autoritativt skjema (opprettes/migreres ved oppstart).

| Tabell               | Nøkkelfelt                                                              |
|----------------------|------------------------------------------------------------------------|
| `members`            | id, email (unik), name, role (`admin`/`member`), created_at            |
| `otp_codes`          | id, email, code_hash, expires_at                                       |
| `tokens`             | token_hash (PK), member_id, expires_at                                 |
| `cabins`             | id, name (unik), sort_order                                            |
| `bookings`           | id, cabin_id, member_id, member_name, start_date, end_date, note       |
| `purchases`          | id, cabin_id, title, comment, price, bought, bought_by_name, created_by, source |
| `recurring_expenses` | id, cabin_id, title, comment, price, day_of_month, active, last_generated |
| `maintenance`        | id, cabin_id, title, description, status, due_date, created_by         |
| `chat_messages`      | id, member_id, member_name, body, created_at                           |
| `logbook_entries`    | id, cabin_id, member_id, title, period_from, period_to, participants, body |

De fire hyttene (Gartha rød, Gartha hvit, Gartha anneks, Skeikampen) seedes ved
første oppstart. Alt domenedata knyttes til en `cabin_id` (unntatt `chat_messages`,
som er felles). Hyttebok-bilder lagres på disk under `/uploads` og refereres som
URL i markdown-teksten (`body`).

### Faste utgifter
`recurring_expenses` materialiseres til `purchases` (med `source = 'recurring'`)
én gang per måned, når dagens dato har passert `day_of_month`. Idempotent via
`last_generated` (`YYYY-MM`). Kjøres ved oppstart og hver 6. time (`setInterval` i
`server.js`) og kan trigges manuelt av admin (`POST /api/recurring/run`).

## Autentisering

Implementert med e-post-OTP og opake tokens — håndheves server-side:

- **Register**: kun e-poster i `members` kan logge inn. Admin forvalter registeret.
- **Engangskode**: 6 sifre, 10 min levetid, lagret kun som SHA-256-hash i `otp_codes`.
- **Token**: tilfeldig streng (32 byte) lagret som hash i `tokens`, 30 dagers
  levetid. Klienten lagrer klartekst-tokenet i `localStorage` og sender det som
  `X-Access-Token` (eller `Authorization: Bearer …`). `requireAuth`/`requireAdmin`
  i `api/src/auth.js` validerer på hvert kall.
- **Roller**: `admin` (full tilgang, medlemsforvaltning) og `member`. Første admin
  seedes fra `ADMIN_EMAIL`.

### E-post via Microsoft Graph
Engangskoder sendes med Graph `sendMail` på en M365-tenant, via client credentials
(app-tillatelsen `Mail.Send`). Konfigureres med
`TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` og `MAIL_SENDER`. Er ikke
Graph konfigurert, logges koden i stedet (lokal utvikling uten hemmeligheter).

Alternativ: SMTP AUTH mot `smtp.office365.com` — men Microsoft faser ut SMTP basic
auth, så Graph er anbefalt for nye løsninger.
