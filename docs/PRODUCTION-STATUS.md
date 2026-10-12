# PANDORA / ForenX — Production status

**Posledná aktualizácia:** 2026-10-12  
**Účel:** Aktuálny overovací záznam. Nenahrádza normatívny kontrakt v [SOURCE-OF-TRUTH.md](SOURCE-OF-TRUTH.md).

## Verified

| Kontrola | Výsledok |
|---|---|
| Main na produkcii | `bf00a3a77ab2069778c97842ad95c40a8c1ce25e` |
| Supabase projekt | `tlmuvzrgighahnjkxoyw` |
| Lokálny health | HTTP 200 |
| Verejný health | HTTP 200 |
| PM2 | `pandora-browser` online |
| Service worker | `/sw.js` HTTP 200 |
| Produkčný read-only smoke | 45 passed, 0 failed, 20 skipped |
| Produkčný smoke traffic | 1 018 GET požiadaviek, 0 HTTP 5xx |

## Neoverené alebo otvorené

- Produkčný smoke neposielal POST/PUT/PATCH/DELETE; preto nedokazuje produkčný write guard.
- Cross-origin a service-worker write probes boli preskočené v produkcii; lokálne prešli v PR #66.
- ICO Atlas runtime autentifikácia vyžaduje samostatné overenie bez zverejnenia key.
- Unit-testovaný WebAuthn/CSP success path nie je týmto read-only smoke výsledkom preukázaný v produkcii.
- Autentifikované biznis workflowy treba overovať syntetickým testovacím prípadom a normálnym consent flowom.

## Safety boundaries

- Do dokumentácie nepatria kľúče, tokeny, cookies ani celé ENV hodnoty.
- Zakázaný Supabase projekt `pptkimvmhekrovsltdqv` sa nesmie použiť.
- Read-only smoke nesmie zapisovať produkčné dáta.
