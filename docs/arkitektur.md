# Arkitektur — Hytteportal

## Oversikt

```
┌────────────────────┐        HTTPS         ┌──────────────────────┐
│  PWA (frontend/)    │  ───────────────►    │  Azure Functions     │
│  HTML/CSS/JS        │   /api/*             │  Node (v4-modell)     │
│  Service worker     │  ◄───────────────    │  mssql-driver         │
└────────────────────┘                       └──────────┬───────────┘
                                                         │ TDS (kryptert)
                                                 ┌───────▼────────────┐
                                                 │  Azure SQL Database │
                                                 │  (serverless)       │
                                                 └─────────────────────┘
```

- **Frontend** er en ren statisk PWA uten byggsteg. Kan hostes på Azure Static Web
  Apps, en enkel nginx, eller hva som helst som serverer statiske filer.
- **API** er Node på Azure Functions med v4-programmeringsmodellen (`app.http(...)`),
  én fil per funksjonsområde under `api/src/functions/`.
- **Lagring** er **Azure SQL Database** via `mssql` (Tedious) — en ren JS-driver
  uten native modul. Datalaget er isolert i `api/src/db.js` bak et lite sett
  async-hjelpere (`query`, `queryOne`, `exec`, `withTx`).

## Azure SQL — oppsett og persistens

Data ligger i en managed Azure SQL Database, ikke på funksjonens lokale disk.
Dermed overlever alt cold start, deploy og utskalering — også på Static Web Apps
sine managed functions.

Anbefalt: **serverless**-nivå. Den auto-pauser når appen står stille (familie-app
som er tom mesteparten av døgnet) og starter igjen ved neste kall. `db.js` bruker
romslige connection/request-timeouts (60 s) nettopp fordi første kall etter en
pause kan bruke noen sekunder på å vekke databasen.

Oppsett (engangs):
- Opprett en Azure SQL-server + database (serverless) i portalen.
- Sett `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD` (eller
  `SQL_CONNECTION_STRING`) som app-innstillinger.
- Åpne brannmuren: tillat *Azure-tjenester* (for Functions) og din egen IP (for
  lokal utvikling) under SQL-serverens *Networking*.
- Skjema og seeding (fire hytter + admin fra `ADMIN_EMAIL`) kjøres idempotent ved
  første tilkobling — ingen manuell migrering nødvendig.

Viktige hensyn:
- **Samtidighet.** Azure SQL håndterer samtidige lesere/skrivere. Kritiske
  lese-så-skrive-operasjoner (FCFS-booking og materialisering av faste utgifter)
  kjøres i serialiserbare transaksjoner med `UPDLOCK, HOLDLOCK` (`withTx` i `db.js`)
  for å hindre race-tilstander.
- **Backup.** Azure SQL tar automatiske backups (point-in-time restore); ingen
  egen backup-jobb nødvendig slik SQLite-fila krevde.

Datalaget er isolert i `api/src/db.js`, så et framtidig bytte (f.eks. til
PostgreSQL) påvirker i hovedsak bare den fila og SQL-dialekten i spørringene.

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

De fire hyttene (Gartha rød, Gartha hvit, Gartha anneks, Skeikampen) seedes ved
første oppstart. Alt domenedata knyttes til en `cabin_id`.

### Faste utgifter
`recurring_expenses` materialiseres til `purchases` (med `source = 'recurring'`)
én gang per måned, når dagens dato har passert `day_of_month`. Idempotent via
`last_generated` (`YYYY-MM`). Kjøres av en daglig timer-funksjon
(`recurring-timer`) og kan trigges manuelt av admin (`POST /api/recurring/run`).

## Autentisering

Implementert med e-post-OTP og opake tokens — håndheves server-side:

- **Register**: kun e-poster i `members` kan logge inn. Admin forvalter registeret.
- **Engangskode**: 6 sifre, 10 min levetid, lagret kun som SHA-256-hash i `otp_codes`.
- **Token**: tilfeldig streng (32 byte) lagret som hash i `tokens`, 30 dagers
  levetid. Klienten lagrer klartekst-tokenet i `localStorage` og sender det som
  `Authorization: Bearer …`. `requireAuth`/`requireAdmin` i `api/src/auth.js`
  validerer på hvert kall.
- **Roller**: `admin` (full tilgang, medlemsforvaltning) og `member`. Første admin
  seedes fra `ADMIN_EMAIL`.

### E-post via Microsoft Graph
Engangskoder sendes med Graph `sendMail` på samme M365-tenant som Functions kjører
på, via client credentials (app-tillatelsen `Mail.Send`). Konfigureres med
`TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` og `MAIL_SENDER`. Er ikke
Graph konfigurert, logges koden i stedet (lokal utvikling uten hemmeligheter).

Alternativ: SMTP AUTH mot `smtp.office365.com` — men Microsoft faser ut SMTP basic
auth, så Graph er anbefalt for nye løsninger.
