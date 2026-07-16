# Hytteportal

PWA for å administrere og planlegge **bruk, innkjøp og vedlikehold** av tre hytter
som familien eier sammen.

> Repoet heter foreløpig `kalender-og-vaermelding`, men prosjektet er hytteportalen.
> Repoet kan gis nytt navn til `hytteportal` på github.com når som helst — historikken beholdes.

## Konsept

En felles, mobilvennlig app for familien der vi kan:

- **Bruk** — se og reservere hvem som bruker hvilken hytte når (booking-kalender)
- **Innkjøp** — felles handleliste / ønskeliste per hytte, og hvem som har lagt ut for hva
- **Vedlikehold** — logg og planlegg vedlikeholdsoppgaver, dugnader og status

Tre hytter administreres i samme app, hver med egen kalender, handleliste og vedlikeholdslogg.

## Teknisk stack

| Lag        | Teknologi                                                        |
|------------|------------------------------------------------------------------|
| Frontend   | Ren HTML/CSS/JS i browser — ingen rammeverk, ingen byggsteg      |
| PWA        | `manifest.webmanifest` + service worker (`sw.js`) for offline    |
| API        | Node på **Azure Functions** (v4 programmeringsmodell)            |
| Lagring    | **SQLite** via `better-sqlite3`                                  |

Se [`docs/arkitektur.md`](docs/arkitektur.md) for detaljer, inkludert hvordan SQLite
persisteres på Azure Functions (Azure Files-mount, siden funksjoners lokale disk er flyktig).

## Struktur

```
frontend/                 # Statisk PWA — kan serveres av hva som helst (Azure Static Web Apps, nginx, ...)
  index.html              # App-skall med tre seksjoner: Bruk, Innkjøp, Vedlikehold
  manifest.webmanifest    # PWA-manifest (installasjon på hjemskjerm)
  sw.js                   # Service worker (offline-caching)
  css/style.css           # Globale stiler, dark/light via CSS custom properties
  js/app.js               # App-logikk, SW-registrering, rendering
  js/api.js               # Liten API-klient mot Azure Functions
  icons/                  # App-ikoner (se icons/README.md)

api/                      # Azure Functions (Node, v4-modell)
  host.json
  package.json
  local.settings.json.example
  src/db.js               # SQLite-lag (better-sqlite3), skjema + helpers
  src/functions/health.js # GET /api/health — helsesjekk
  src/functions/cabins.js # GET/POST /api/cabins — hytter (eksempel-endepunkt)

docs/arkitektur.md        # Arkitektur, datamodell-skisse og deploy-notater
```

## Utvikling lokalt

### Frontend
Server `frontend/` statisk. Enkleste vei:

```bash
cd frontend
npx serve .        # eller: python3 -m http.server 3000
```

### API (Azure Functions)
Krever [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) og Node 18+.

```bash
cd api
npm install
cp local.settings.json.example local.settings.json
npm start          # func start — kjører på http://localhost:7071
```

Frontend peker mot API-et via `API_BASE` i `frontend/js/api.js`
(default `http://localhost:7071/api` lokalt).

## Status

Dette er startskjelettet. Datamodell og funksjoner konkretiseres etter hvert som
kravene beskrives nærmere. `cabins`-endepunktet og de tre seksjonene i frontend er
eksempler som viser formen — ikke ferdig funksjonalitet.
