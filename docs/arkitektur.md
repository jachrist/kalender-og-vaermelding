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

## Datamodell (skisse)

Startpunkt — konkretiseres når kravene beskrives nærmere.

| Tabell         | Nøkkelfelt (skisse)                                             |
|----------------|----------------------------------------------------------------|
| `cabins`       | id, name, location, created_at                                 |
| `bookings`     | id, cabin_id, member, from_date, to_date, note                 |
| `purchases`    | id, cabin_id, title, needed/bought, amount, paid_by, created_at |
| `maintenance`  | id, cabin_id, title, status, due_date, assigned_to, note       |

Tre hytter deler samme skjema; alt knyttes til en `cabin_id`.

## Autentisering (åpent spørsmål)

Foreløpig ingen auth. Aktuelle veier for en liten, lukket familiegruppe:
- Azure Functions `authLevel` + delt nøkkel (enkelt, men grovt).
- Azure Static Web Apps innebygde auth (Microsoft/Google-innlogging) med
  rollestyring — passer godt til en PWA + Functions-oppsett.
- E-post-OTP (som i korportal-prosjektet) hvis vi vil unngå eksterne
  identitetsleverandører.

Avklares sammen med kravene.
