# Benchmark mot ekte søknadsskjemaer

Måler hvor godt utfyllingsmotoren fungerer på forskjellige plattformer. Åpner ekte skjemaer i
Chrome, kjører motoren med en oppdiktet testprofil (`test-profile.json`) og teller hva som ble
fylt ut. **Ingenting sendes inn.**

```bash
npm run build -w @soknadsprofil/extension        # bygger filler.js som testes
npm run benchmark -w @soknadsprofil/extension    # alle sider i sites.json
npm run benchmark -w @soknadsprofil/extension -- lever   # bare sider som matcher «lever»
```

Krever Google Chrome installert (bruker den via Playwright, ingen ekstra nedlasting).

## Resultater
`e2e/results/<side>/` (ignorert av git):
- `report.json`: alle felt med label, om de er påkrevd, om de ble fylt ut og med hva, motorens rapport og logg (`[Masterkey]`)
- `screenshot.png`: hele siden etter utfylling
- `page.html`: kopi av skjemaet, nyttig for å lage enhetstester

## Legge til sider
I `sites.json`: enten `resolve` (henter en aktiv annonse fra plattformens API: greenhouse, lever,
ashby, workable, smartrecruiters) eller en fast `url`. Norske plattformer og Workday krever ofte
faste URL-er.

## Kjente begrensninger
- Sider med captcha mot automatiske nettlesere (f.eks. SmartRecruiters) kan ikke testes automatisk.
- ⚠ «iframe fra et annet domene»: testen fyller ut likevel, men den ekte extensionen når ikke slike
  skjemaer i dag (den har bare tilgang til selve fanen).
- Prosenten teller alle synlige felt, også spørsmål profilen ikke har svar på (visum, kjønn …).
  Se «Utfylt» og «Påkrevd, men tomt» for en reell vurdering.
