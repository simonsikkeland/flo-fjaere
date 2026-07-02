# 🌊 Flo og fjære

Statisk nettside som viser flo og fjære (høyvann/lavvann) for steder langs norskekysten.
Søk etter et sted, og få dagens vannstandskurve pluss tidevannstabell for de neste dagene.

Ingen backend og ingen byggesteg – ren HTML/CSS/JS som kaller Kartverkets åpne API-er direkte fra nettleseren:

- **Stedssøk:** [Kartverkets stedsnavn-API](https://api.kartverket.no/stedsnavn/v1/) (JSON)
- **Tidevann:** [Kartverkets vannstands-API](https://vannstand.kartverket.no/tideapi_no.html) (XML)

Høyder oppgis i cm over sjøkartnull. Tallene er tidevannsprediksjoner – værets bidrag (vind, lufttrykk) kommer i tillegg.

## Kjør lokalt

Åpne mappa med en hvilken som helst statisk server, f.eks.:

```bash
npx serve .
# eller
python -m http.server 8000
```

## Publiser på GitHub Pages

1. Push repoet til GitHub.
2. Gå til **Settings → Pages** i repoet.
3. Under **Build and deployment**, velg **Deploy from a branch**, branch `main` og mappe `/ (root)`.
4. Siden blir tilgjengelig på `https://<brukernavn>.github.io/<repo-navn>/`.

## Deling

Valgt sted lagres i URL-en (`?sted=Ålesund&lat=62.47&lon=6.15`), så lenker kan deles direkte.
