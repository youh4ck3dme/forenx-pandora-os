# AGENTS.md — PΛND0RΛ / ForenX

Tento súbor platí pre celý repozitár. Pred každou zmenou si prečítaj [`docs/SOURCE-OF-TRUTH.md`](docs/SOURCE-OF-TRUTH.md).

## Základné pravidlá

- Najprv analyzuj, potom upravuj.
- Opravuj root cause, nie iba symptóm.
- Rob minimálne zmeny a zachovaj existujúce necommitnuté zmeny.
- Používaj skutočné cesty projektu: Next.js App Router je v `app/`, doménová logika v `lib/forza/` a UI v `components/`.
- Nevymýšľaj neexistujúce API, tabuľky, route ani runtime.
- `AI OUTPUT ≠ EVIDENCE`: každý forenzný záver musí mať zdroj a stav overenia.
- Fail-closed bezpečnostné kontroly sa nesmú obchádzať kvôli zelenému testu alebo demo flow.

## Secrets a prostredia

- Nikdy nevypisuj secret hodnoty do terminálu, logu, commitu ani odpovede.
- Kontroluj ich iba ako `SET`, `MISSING`, dĺžku alebo zamaskovanú hodnotu.
- Produkcia je mimo rozsahu bežného vývoja. Používaj local/staging a oddelené fixture UUID.
- `.env.local`, `.env.production` a lokálne staging loadery nesmú byť commitnuté.
- Hosted Edge Function nesmie volať localhost ani private IP.

## Forenzné a integračné invarianty

- Dôkaz má zachovaný SHA-256, metadata, verification status a auditnú stopu.
- Analýza je povolená iba nad overeným dôkazom.
- Hash mismatch, neoverený evidence status, nepovolený download host, neplatný webhook secret alebo duplicate idempotency key musia skončiť bezpečným odmietnutím.
- ForenZX webhook používa presný header `x-forenzx-webhook-secret`.
- MCP kontrakt musí zostať kompatibilný s `forenzx_analysis_start`, `download_url`, `download_filename`, SSE progress a terminal state.

## Overovanie

Po zmene spusti najmenší relevantný test a podľa rozsahu aj:

```powershell
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:regression:forenzx
```

Neuvádzaj „hotovo“, „100 % ready“ alebo „PASS“, ak príslušný test/deployment skutočne neprešiel. Pri chýbajúcom secret-e, deployment-e, packu alebo externom prístupe uveď `BLOCKED` a presný blocker.

## Zmena dokumentácie

Ak zmeníš dátový tok, env kontrakt, API, bezpečnostné pravidlo, runtime správanie alebo testovací príkaz, aktualizuj `docs/SOURCE-OF-TRUTH.md` a súvisiacu dokumentáciu v tom istom commite.
