# Arkitektur — Hytteportal

## Oversikt

```
┌────────────────────┐        HTTPS         ┌──────────────────────┐
│  PWA (frontend/)    │  ───────────────►    │  Azure Functions     │
│  HTML/CSS/JS        │   /api/*             │  Node (v4-modell)     │
│  Service worker     │  ◄───────────────    │  better-sqlite3       │
└────────────────────┘                       └──────────┬───────────┘
                                                         │
                                                 ┌───────▼────────┐
                                                 │  SQLite-fil     │
                                                 │  (Azure Files)  │
                                                 └────────────────┘
```

- **Frontend** er en ren statisk PWA uten byggsteg. Kan hostes på Azure Static Web
  Apps, en enkel nginx, eller hva som helst som serverer statiske filer.
- **API** er Node på Azure Functions med v4-programmeringsmodellen (`app.http(...)`),
  én fil per funksjonsområde under `api/src/functions/`.
- **Lagring** er SQLite via `better-sqlite3` — synkront, raskt og enkelt for et
  familie-datasett av denne størrelsen.

## SQLite på Azure Functions — persistens

Azure Functions kjører på flyktig lokal disk: filer skrevet til funksjonens
lokale filsystem kan forsvinne ved restart, deploy eller utskalering. En SQLite-fil
på lokal disk vil derfor **ikke** være trygg.

Løsning: monter en **Azure Files**-share på funksjons-appen og legg databasefilen der.

- Sett `SQLITE_DB_PATH` til en sti på den monterte share-en, f.eks.
  `/mounted-data/hytteportal.db`.
- Konfigurer mount via `az webapp config storage-account add` (Linux
  Consumption/Premium) eller path-mapping i portalen.

Viktige hensyn:
- **Én skriver om gangen.** SQLite tåler samtidige lesere, men skriving serialiseres.
  Med WAL-modus (satt i `db.js`) og et lite familie-datasett er dette uproblematisk,
  men sett gjerne funksjons-appens `maxConcurrentRequests`/skalering konservativt.
- **Backup.** Ta jevnlig kopi av `.db`-filen (f.eks. en timer-trigget funksjon som
  kopierer til en annen share eller Blob Storage).

Alternativer dersom skrivelast eller samtidighet vokser: Azure SQL, PostgreSQL
Flexible Server, eller Cosmos DB. Datalaget er isolert i `api/src/db.js`, så et
bytte påvirker ikke resten av API-et nevneverdig.

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
