# App-ikoner

`icon.svg` er et enkelt vektor-ikon som fungerer for favicon, apple-touch-icon og
manifest (moderne browsere støtter SVG-ikoner i manifestet).

For best mulig installasjonsopplevelse på alle plattformer bør det legges til
PNG-ikoner i faste størrelser (192×192 og 512×512, både `any` og `maskable`).
Disse kan genereres fra `icon.svg` senere, f.eks. med et verktøy som
[PWA Asset Generator](https://github.com/elegantapp/pwa-asset-generator), og
legges inn i `manifest.webmanifest`.
