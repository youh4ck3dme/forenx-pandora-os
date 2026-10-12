# PΛND0RΛ / ForenX

## Forenzná inteligencia a správa dôkazov

PANDORA / ForenX je platforma orientovaná na prípady, ktorá uchováva, overuje, analyzuje a audituje digitálne dôkazy. Základné pravidlo:

> **Výstup AI nie je dôkaz.**

Zistenia AI zostávajú hypotézami, kým nie sú naviazané na overený zdroj. Správanie runtime, integrita dôkazov a auditovateľnosť majú prednosť pred výstupom modelu.

## Architektúra

- **Webová aplikácia:** Next.js, React a TypeScript; produkčný proces beží v PM2 za nginx.
- **Identita a dáta:** Supabase Auth a PostgreSQL s kontrolou vlastníctva prípadov, Row Level Security (RLS), obmedzeniami a serverovými funkciami.
- **Dôkazy:** S3-kompatibilné úložisko objektov a PostgreSQL ledger dôkazov, SHA-256 overovanie, zdrojové snapshoty a append-only auditná história.
- **Analýza:** workflowy prípadov vo Forza a serverové AI integrácie. Výstup AI sa pred uložením parsuje, validuje podľa schémy a kontroluje voči oprávneným dôkazom.
- **Klienti:** Browser/PWA a desktopová aplikácia Electron; mobilná konfigurácia je oddelená v `mobile/`.

## Forenzné invarianty

1. **Proveniencia:** Zistenie musí odkazovať na dôkaz alebo zachytený snapshot zdroja. Uloženie či opakovanie tvrdenia AI z neho dôkaz neurobí.
2. **Integrita:** Dôkaz je naviazaný na prípad, vlastníka, referenciu úložiska a overený SHA-256. Neúspešné overenie operáciu zastaví.
3. **Autorizácia:** Najprv autentifikácia, potom kontrola vlastníctva prípadu a dôkazu. ID dodané klientom samo osebe prístup neudeľuje.
4. **Append-only história:** Auditné udalosti a nemenné analytické behy uchovávajú kto/čo/kedy aj hashovú nadväznosť.
5. **Deterministické výpočty:** Časové rozdiely a závažnosť sa počítajú aplikačnou logikou, nie jazykovým modelom.
6. **Bez tichého zníženia ochrany:** Ak chýba autorizácia, integrita alebo bezpečné uloženie, operácia sa odmietne.

## Kľúčové funkcie

### Asset Timeline Forensics — „Časostroj majetku & Detektor bielych koní“

PR [#61](https://github.com/youh4ck3dme/forenx-pandora-os/pull/61) pridal workflow na koreláciu udalostí súvisiacich s majetkom v rámci prípadu, naviazaný na dôkazy. Zmeny sú súčasťou produkčného main bf00a3a77ab2069778c97842ad95c40a8c1ce25e a obe Asset Timeline migrácie sú potvrdené v histórii produkčného Supabase projektu. Dostupnosť konkrétneho autentifikovaného workflowu sa overuje samostatným end-to-end testom; read-only produkčný smoke potvrdzuje runtime, routing a bezpečnostné hranice.

Návrh workflowu:

- Každý vstup viaže na dôkazy z vlastneného prípadu a ich overený SHA-256; overené hashe vstupujú do kanonického digestu analýzy.
- Overuje citované úryvky voči zdroju a kontroluje referencie ešte pred prijatím zistenia. Neplatné alebo nepodložené právne/zdrojové tvrdenia sa degradujú, namiesto toho, aby sa označili za overené.
- Zachováva sémantiku dátumu bez času a neznámeho času bez vymýšľania presnosti.
- Časový rozdiel a závažnosť počíta deterministicky v aplikačnej logike.
- Ukladá verziu a hash promptu aj skutočne použitý provider/model vrátane fallbacku.
- Každý výsledok ukladá ako samostatný nemenný beh s SHA-256 výsledku, väzbami na dôkazy, metadátami workflowu a auditnou udalosťou.
- Vynucuje kanonickú idempotenciu a prepája opakované behy cez `supersedes_run_id`; klientský kľúč nemôže zmeniť kanonickú identitu vstupu.
- Zápisy povoľuje iba server/service role. Autentifikovaní klienti môžu čítať iba behy vlastných prípadov cez RLS; aktualizácie a mazanie sú blokované.

## Produkčné nasadenie

| Položka | Aktuálna produkčná konfigurácia |
|---|---|
| Verejná aplikácia | [pandora.whoiswho.at](https://pandora.whoiswho.at) |
| VPS | `2.29.52.59` |
| Adresár aplikácie | `/var/www/pandora-browser` |
| Proces | PM2 `pandora-browser`, port `3005` |
| Reverse proxy | nginx |
| Produkčná databáza | Supabase projekt `tlmuvzrgighahnjkxoyw` |
| Produkčný main | `bf00a3a77ab2069778c97842ad95c40a8c1ce25e` |

Oficiálny vstupný bod VPS releasu je `scripts/deploy/staging-update.sh`. Predvolene vykoná dry-run, nový release zostaví a smoke-testuje oddelene ešte pred prepnutím, následne reloadne PM2 a pri zlyhaní vykoná rollback. Databázové migrácie **nespúšťa**; ich nasadenie je samostatný kontrolovaný krok.

## Databáza

Schéma Supabase/PostgreSQL je verzovaná v `supabase/migrations/`. Produkčný projekt je `tlmuvzrgighahnjkxoyw`.

- Pred aplikáciou migrácie skontroluj stav migrácií a presný plán zmien.
- `supabase db reset` nikdy nepoužívaj v produkcii.
- Neupravuj produkčnú schému ručne ani históriu migrácií bez dôkazov.
- Migrácie Asset Timeline `20261010120000_asset_timeline_forensics.sql` a `20261010210000_asset_timeline_post_merge_hardening.sql` sú súčasťou `main` a ich záznamy sú potvrdené v produkčnej histórii Supabase.

## AI

Kľúče providerov zostávajú na serveri. AI je nedôveryhodná analytická súčasť: požiadavky autentifikujeme, kontrolujeme súhlas a vlastníctvo, viažeme a overujeme dôkazy a štruktúrovaný výstup validujeme pred nemenným uložením. Pri výsledku sa zachová proveniencia promptu a provideru/modelu. Secrets nepatria do README, repozitára, browser bundlu, URL ani logov.

## Testovanie a overovanie

Spusti kontroly relevantné pre zmenu a výsledky uvádzaj oddelene:

```bash
npm run typecheck
npx vitest run
npm run build
```

Správanie databázy vyžaduje overenie migrácií a RLS voči zamýšľanej databáze. Úspešný unit test, build ani health endpoint samostatne nedokazujú produkčné správanie. Produkčný read-only smoke sa spúšťa cez `SMOKE_READONLY=1 npm run test:smoke:prod`; aktuálny dôkaz je vedený v `docs/PRODUCTION-STATUS.md`.

## Postup release a deploy

1. Skontroluj kód a migráciu na určenej vetve; spusti typecheck, cielené testy, príslušnú kompletnú testovaciu sadu a build.
2. Over poradie migrácií a vzdialený stav databázy. Migrácie aplikuj iba cez schválený explicitný postup; VPS deploy skript ich nespúšťa.
3. Zlúč schválený release do `main`.
4. Spusti `scripts/deploy/staging-update.sh` na kontrolu plánu. `--apply` použi len pre zamýšľaný release; ak sú prítomné nové migrácie, potvrď ochrannú podmienku skriptu a migráciu aplikuj samostatným databázovým postupom.
5. Over nasadený commit, PM2 proces, HTTP health endpoint, aplikačné smoke kontroly a každý zmenený end-to-end workflow. Zaznamenaj dôkaz ku každému výsledku.

## Bezpečnostné hranice

- Browser a desktop klienti sú nedôveryhodní. Nikdy im nevystavuj Supabase service-role, S3, databázové ani AI provider kľúče.
- Autentifikáciu, vlastníctvo prípadu a vlastníctvo dôkazu kontroluj na serveri; databázovú hranicu zároveň vynucuje RLS.
- Behy Asset Timeline môže zapisovať iba dôveryhodný server. Klientsky prístup je iba na čítanie a obmedzuje ho RLS.
- Uploady, externé zdroje, odpovede modelu a identifikátory od klienta považuj za nedôveryhodný vstup.
- Zachovaj nemenné dôkazy a auditné záznamy; staršie behy analýzy neprepisuj.
- Do dokumentácie nezapisuj secrets ani citlivé prevádzkové konfigurácie.

## Aktuálny stav — 12. október 2026

- **Produkčný runtime:** `https://pandora.whoiswho.at` beží na main `bf00a3a77ab2069778c97842ad95c40a8c1ce25e`; lokálny aj verejný `/api/healthz/` vrátili HTTP 200.
- **Produkčný deploy:** atomický release prebehol cez `scripts/deploy/staging-update.sh`; PM2 proces `pandora-browser` je online.
- **PWA:** `/sw.js` vracia HTTP 200 a produkčný runtime používa kill-switch service worker bez fetch cache handlera.
- **Read-only smoke:** 45 testov prešlo, 0 zlyhalo a 20 bolo preskočených; 1 018 požiadaviek bolo GET na produkčnom origin-e. Preskočené boli write/probe testy, preto tento výsledok sám osebe nepotvrdzuje produkčné odoslanie zápisu ani cross-origin obídenie cez service worker.
- **Oprava Autopilot 403:** predchádzajúci produkčný smoke potvrdil HTTP 200 a vytvorenie workflowu; neskoršie overenia musia používať bezpečný syntetický prípad a normálny AI súhlas.
- **Asset Timeline Forensics:** obe migrácie (`20261010120000` a `20261010210000`) sú v produkčnej histórii Supabase projektu `tlmuvzrgighahnjkxoyw`.
- **ICO Atlas:** stav runtime kľúča sa v dokumentácii nepredpokladá ani nezverejňuje; pred použitím ICO workflowu treba samostatne overiť dostupnosť a autentifikáciu `ICO_ATLAS_API_URL`/`ICO_ATLAS_API_KEY`.
- **Secrets:** README neobsahuje prihlasovacie údaje ani kľúče.
## Licencia

WTFPL — Do What The Fuck You Want To Public License.
