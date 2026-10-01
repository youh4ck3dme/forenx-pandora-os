# Blueprint: dokončenie PΛND0RΛ / ForenX pre produkčné používanie

## 1. Cieľ a záväzné rozhodnutia

Prvým výsledkom bude **riadený webový pilot pre pozvaných používateľov a reálne prípady**, nie iba úspešne spustený kontajner.

- Zachovať vzhľad Pandory, karty a navigáciu, ale vykresľovať **jeden prehliadačový obal**.
- Pandora a EvidenceCore zostanú samostatné aplikácie so spoločným Supabase projektom. Rovnaký používateľ môže vidieť rovnaké prípady; rôzni používatelia musia zostať oddelení.
- Overiť celý tok: **prihlásenie → prípad → príloha → serverové overenie integrity → analýza → ľudská kontrola → export**.
- AI dostane iba minimalizovaný a redigovaný obsah po potvrdení používateľa. Zlyhanie kontroly znamená neodoslanie.
- Cieľ obnovy: **RPO najviac 15 minút**, teda maximálna strata posledných zmien; **RTO najviac 4 hodiny**, teda obnova prevádzky.
- Počítať s PITR. Aktivácia platených služieb vyžaduje osobitné schválenie kalkulácie; dovtedy bez nových reálnych prípadov.
- Prvá verzia nezahŕňa offline zápis dôkazov, produkčný Electron, natívne mobilné aplikácie, verejnú registráciu ani platby.

### Overený východiskový stav

| Oblasť            | Súčasný stav                                                           |
| ----------------- | ---------------------------------------------------------------------- |
| Git               | Východiskový commit `86597c4cefbb71c6da29d53fe67a93b9f120dd34`         |
| Produkcia         | Stále pôvodný image `sha256:893d78c9…`, deklarovaná revízia `9a4676a…` |
| VPS               | Disk pri poslednej kontrole 100 %, 0 voľného miesta                    |
| HTTPS proxy       | Porty 80/443 obsluhuje Apache/httpd                                    |
| Copilotove opravy | Samostatný necommitnutý snapshot, nie overený release                  |
| Testy             | Lokálne výsledky hlásené Claudom; úplný produkčný tok neoverený        |
| UI                | Pozorované dvojité vnorené rozhranie                                   |
| Upload            | Produkčné `401` zatiaľ bez potvrdeného vyriešenia                      |

**Východiskový commit nie je finálny release.** Po integrácii opráv vznikne nový commit, ktorý musí prejsť všetkými bránami nižšie.

## 2. Implementácia v záväznom poradí

### P0 — Stabilizovať VPS a zachovať rozpracovanú prácu

1. Určiť jedného vykonávateľa nasadenia. Ostatní agenti odovzdávajú zmeny cez Git alebo kontrolovaný diff, nie úpravami produkčných snapshotov.
2. Zachovať Copilotove zdrojové zmeny, testy, identifikátory images a konfiguráciu. Pri plnom disku zálohovať streamovaním mimo VPS, nie vytváraním ďalšieho archívu na serveri.
3. Ochrániť aktuálny image a overený rollback pred čistením.
4. Vytvoriť presný zoznam nepoužívaných build artefaktov. Odstraňovať iba konkrétne odsúhlasené položky; žiadny plošný Docker prune, mazanie volumes ani databáz.
5. Pred nasadením dosiahnuť aspoň 20 % voľného disku a kapacitu pre nový image aj rollback. Ak to bezpečné čistenie nedosiahne, vyžiadať rozšírenie kapacity.
6. Zmapovať závislosti lokálneho Supabase stacku a príčinu `unhealthy` Kongu. Názov „staging“ nie je dôkaz, že službu nikto nepoužíva.

**Brána:** stabilný server, zachované opravy, použiteľný rollback a dostatok kapacity. Dovtedy žiadny ďalší produkčný build.

### P1 — Jeden zdroj pravdy a reprodukovateľný release

- Vychádzať z repozitára `larsenevans/forenz-pandora-osss`; Copilotove zmeny porovnať s overeným commitom a preniesť po jednotlivých opravách spolu s testami.
- Nezameniť rozdiel medzi dvoma snapshotmi za Git diff konkrétneho commitu.
- Opraviť existujúci handoff, backlog a Source of Truth: aktuálny SHA, skutočný Apache proxy, Docker runtime, env zdroj, presné HTTP výsledky a rollback.
- Zjednotiť CI a Docker na Node.js 22 LTS s pripnutými verziami. Súčasný Docker používa Node 20, ktorý je už EOL. [Node.js releases](https://nodejs.org/en/about/previous-releases)
- Build vykonávať v Linux GitHub Actions, nie na produkčnom VPS. Testovaný runtime image publikovať do privátneho GHCR; nasadzovať podľa digestu.
- Build kontext musí vylučovať aj holý `.env`, všetky reálne env súbory, dumpy a credentials. Povolené zostanú iba bezpečné šablóny.
- Verejnú Supabase konfiguráciu explicitne nastaviť pri builde; serverové secrets poskytovať iba za behu. Zmena runtime env neopraví už zabudované `NEXT_PUBLIC_*` hodnoty. [Next.js dokumentácia](https://nextjs.org/docs/app/guides/environment-variables)
- Produkčný projekt zostáva `tlmuvzrgighahnjkxoyw`. Izolované testy používajú samostatnú testovaciu konfiguráciu, nie produkčné údaje.
- Existujúce aplikované migrácie neprepisovať ani neopakovať. Prípadné nové migrácie musia byť aditívne, otestované a samostatne schválené.

**Brána:** jeden finálny SHA, čistý strom, úspešné CI, identifikovateľný image digest a úplný release manifest.

### P2 — Dokončiť autentifikáciu a odstrániť dvojité UI

**Autentifikácia**

- Zjednotiť overovanie identity v middleware a API. Explicitný Bearer token má prednosť; ak je neplatný, požiadavka nesmie potichu prejsť cez inú identitu.
- Integrovať a preveriť serverový session bridge z Copilotových opráv. Cookie vytvára server až po overení tokenu voči Supabase, nie iba dekódovaním JWT.
- Použiť `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` a platnosť odvodenú od overenej relácie. Odstrániť konkurenčný zápis rovnakých cookies cez `document.cookie`.
- Pred presmerovaním po prihlásení počkať na úspešnú synchronizáciu. Ošetriť súbeh refreshu, viacerých kariet a odhlásenia.
- Najviac jeden riadený refresh a opakovanie požiadavky. Žiadne nekonečné slučky.
- Lokálny používateľský profil ani simulovaný passkey nesmú predstavovať prihlásenie. Passkey vstup zostane vypnutý, kým nebude existovať kompletné serverové overenie.
- Prístup do pilota obmedziť serverovo na pozvané účty. Globálne nastavenia zdieľaného Supabase nemeníme bez kontroly dopadu na EvidenceCore.

**Navigácia**

- Neprihlásený vstup na `/` smeruje na `/auth/login/?next=%2Fbrowser%2F`; prihlásený vstup na `/browser/`.
- `/forza/stav/` zostáva verejná.
- Zachovať jeden Pandora shell. Interné forenzné stránky môžu byť vložené ako obsah, nikdy ako ďalší celý browser shell.
- Normalizovať URL pomocou originu a pathname; nepoužívať substring `/forza/` ako dôkaz dôveryhodnosti hosta.
- Pri navigácii vloženého obsahu na prihlasovanie preniesť autentifikačný tok do hlavného okna s bezpečným návratom.
- Ošetriť obnovené staré karty, refresh, históriu a priame odkazy.
- Pre vlastnú doménu používať lokálnu favicon.
- PWA nesmie v pilote cacheovať autentifikované odpovede ani dôkazy. Offline stav musí byť explicitný; žiadne predstierané uloženie.

**Brána:** jedna navigácia, funkčné prihlásenie/obnova/odhlásenie, žiadna autentifikačná slučka a žiadny prístup bez oprávnenia.

### P3 — Uzavrieť prílohy, vlastníctvo a integritu

- Rozlíšiť zobrazované číslo prípadu od interného UUID. API pracuje s overeným UUID; klient nerozhoduje o vlastníkovi.
- Zachovať existujúci tok presign → upload → commit → serverová verifikácia. Pri `401/403` zastaviť upload; neskúšať alternatívnu cestu, ktorá zopakuje operáciu alebo obíde ochranu.
- Každý vstup vrátane downloadu, commitu a analýzy musí overovať používateľa, prípad aj dôkaz.
- Zabezpečiť idempotenciu retry a súbežných požiadaviek databázovými obmedzeniami a atómovými operáciami.
- Databáza a objektové úložisko nie sú jedna transakcia: evidovať rozpracovaný upload, bezpečný retry a rekonciliáciu nedokončených položiek.
- `verified` prideľuje iba server po streamovanom prepočte skutočných bytov. Klientsky hash je tvrdenie na porovnanie.
- Zviazať overenie s konkrétnym objektom/verziou; neskoršie prepísanie nesmie potichu zmeniť obsah dôkazu.
- Na VPS explicitne sprevádzkovať plánovač verifikácie. Samotná existencia endpointu cron nespúšťa.
- Otestovať WORM a audit aj cez privilegované RPC, service role a account-erasure cesty. Súčasne zachovať zákonné, riadené retenčné procesy; žiadne automatické mazanie dôkazov počas pilota.
- Skontrolovať versioning/Object Lock v reálnom buckete. Hetzner vyžaduje aktiváciu Object Lock pri vytvorení bucketu; chýbajúcu ochranu nemožno vyriešiť deklaráciou v dokumentácii. Prípadný nový bucket a presun potrebujú samostatný plán bez prepísania pôvodných dôkazov. [Hetzner Object Lock](https://docs.hetzner.com/storage/object-storage/howto-protect-objects/protect-object-lock-retention/)

**Brána:** oprávnený upload skončí overeným ledgerom a auditom; cudzí účet, podvrhnutý hash a opakovanie požiadavky nemôžu narušiť integritu.

### P4 — Dokončiť AI, CSV a export ako overiteľný pracovný tok

- Nahradiť voľné `record(unknown)` a dvojité type-casty na bezpečnostných hraniciach skutočnými schémami zodpovedajúcimi doménovým typom.
- Opravený alebo neúplný AI JSON označiť ako neúplný; nedoplniť prázdne sekcie a následne ho nevydávať za úspešný výsledok.
- Pôvod analýzy načítať zo serverového workflow záznamu. Klientom dodané `analysisMeta` nie je dôkaz autenticity.
- Každý zdrojový odkaz overiť voči oprávnenému prípadu, existujúcemu dôkazu a jeho integrite. Neviazaný výstup označiť ako hypotézu.
- Pred Mistralom vykonať redakciu, ukázať rozsah odosielania a vyžiadať potvrdenie. Obsah dokumentu ani CSV nesmie rozširovať oprávnenia modelu alebo vyberať cudzí prípad.
- Nastaviť limity veľkosti, súbežných AI úloh, timeoutov a spotreby; prekročenie má jasný používateľský stav.
- Overiť CSV import, čísla, meny, dátumy, duplicity a neplatné riadky bez čiastočne skrytých zápisov.
- PDF export musí na syntetickom prípade reálne vytvoriť PDF a SHA-256 manifest a umožniť nezávislé porovnanie.
- Hash manifestu neprezentovať ako dôkaz pravdivosti tvrdení ani automatickej súdnej prípustnosti.
- ForenZX zapnúť až po úplnom teste jobu vrátane timeoutu, reštartu workeru, duplicity, zlého hashu a konečného výsledku. Samotné `queued` nie je úspešná analýza.

**Brána:** uložený a exportovaný výsledok zachováva zdroje, stav overenia a rozdiel medzi dôkazom, AI hypotézou a ľudským záverom.

### P5 — Pravdivý live stav a použiteľná diagnostika

- Dokončiť všetkých 15 požadovaných kategórií: aplikácia; PostgreSQL dostupnosť, odozva, pripojenia, transakcie, zámky a veľkosť; spisy; document storage; obe Mistral konfigurácie; AI telemetria a úspešnosť; systémové chyby; PDF export.
- Rozlíšiť Supabase Storage od skutočného S3 trezoru príloh. Úspešná kontrola jedného nesmie dokazovať dostupnosť druhého.
- Obnovovať pri otvorení, každých 15 sekúnd a manuálne. Zobraziť čas merania každej položky a varovanie pri zastaraní.
- Zachovať poslednú známu hodnotu pri chybe, ale nevydávať ju za aktuálne úspešné meranie.
- Zrušiť vrstvenie cache, ktoré predlžuje deklarovanú čerstvosť; serverová cache najviac 15 sekúnd, bez ďalšieho CDN stale okna.
- Zachovať tri stavové hodnoty `ok / attention / unavailable`. Pri nulových AI volaniach zobraziť „bez meraní“, nie 100 % úspešnosť. Hranicu chybovosti 10 % vyhodnocovať pred zaokrúhlením.
- PDF dostupnosť určovať reálnym lokálnym self-testom v prehliadači, nie pevnou hodnotou `ok`.
- Konfigurácia AI znamená iba prítomnosť konfigurácie, nie úspešnosť volania modelu.
- Zaviesť korelačné ID naprieč UI, API, uploadom, workerom a AI. Zaznamenávať významné akcie a výsledky, nie heslá, tokeny, obsah dokumentov alebo každý stlačený kláves.
- Použiť štruktúrované logy s rotáciou, existujúcu telemetriu a sanitizovaný diagnostický export. Reporty mimo Gitu; žiadna nová povinná platená monitorovacia služba.
- Alerty: disk 80/90 %, opakované 5xx, nedostupná DB/storage, zaseknutá verifikácia, zlyhané zálohy a neprimeraná chybovosť AI. Otestovať doručenie vlastníkovi.

### P6 — Zálohy, bezpečnostné kontroly a prevádzka

- Nastaviť PITR a overiť dosiahnutie RPO 15 minút. Samostatne zálohovať objekty, konfiguráciu a potrebné kryptografické materiály; Supabase databázová záloha neobsahuje samotné Storage objekty. [Supabase zálohy](https://supabase.com/docs/guides/platform/backups)
- Udržiavať šifrovanú zálohu mimo VPS s oddelenými prístupmi.
- V izolovanom prostredí obnoviť prípad, prílohy, ledger a audit; zmerať RTO a prepočítať hashe.
- Opraviť existujúci disaster-recovery runbook podľa reálnych služieb a podporovaných príkazov.
- Rotovať potvrdene exponované secrets koordinovane pre Pandoru, EvidenceCore, worker a storage. Nevypínať staré prístupy skôr, než sa overia náhrady.
- Vynútiť CSP kompatibilnú s jedným shellom a same-origin iframe, serverové oddelenie secrets, bezpečné chybové odpovede a limity requestov.
- Dôverovať proxy hlavičkám iba od skutočného Apache proxy; overiť, že klient nevie podvrhnúť identitu pre audit a rate limit.
- Pred reálnymi dátami schváliť pravidlá prístupu, retencie, vymazania, cloudovej AI a incidentov. Technické testy samy osebe nepotvrdzujú právny súlad.

## 3. API, typy a dátové hranice

| Rozhranie      | Finálny kontrakt                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session bridge | `POST /api/auth/session`: overený Bearer → serverová cookie; `DELETE`: vyčistenie cookie. Kontrola originu, rate limit, žiadny token v odpovedi. |
| Vault API      | Zachovať existujúce endpointy. Interné UUID, ownership, idempotencia, bezpečné chyby a serverom riadený stav verifikácie.                        |
| Public health  | Zachovať endpoint aj tri statusy; doplniť čas merania jednotlivých kontrol a explicitné rozlíšenie merania od dostupnosti funkcie.               |
| AI dossier     | Typy odvodiť zo striktných schém; serverový pôvod workflowu, overené `sourceRef`, neúplný výsledok nesmie znamenať úspech.                       |
| Zdieľané dáta  | Žiadna nová aplikačná separácia Pandory/EvidenceCore. RLS a mutácie musia rešpektovať vlastníctvo v oboch aplikáciách.                           |
| Rate limiting  | Zdieľané atómové PostgreSQL počítadlo. Výpadok bezpečnostného limitera nesmie viesť k povoleniu operácie ani produkčnému pamäťovému fallbacku.   |

Všetky nové alebo zmenené kontrakty dostanú runtime validáciu a negatívne testy. Nové API nepridávať tam, kde postačí opraviť existujúce.

## 4. Testovací plán a dôkazy

Nahradiť súčasný ukážkový E2E scenár testami skutočných rout, UUID a používateľov. Žiadne falošné Bearer tokeny ani podmienka „ľubovoľný status nad 401 je úspech“.

| Oblasť     | Povinné scenáre                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Auth       | Anonymný vstup, login, zlý token, expirácia, jeden refresh, logout, viac kariet, bezpečný návrat, session sync failure   |
| UI         | Jeden shell, priame odkazy, obnovené karty, iframe auth redirect, mobilná šírka, klávesnica, offline stav                |
| Oprávnenia | Používatelia A/B v oboch aplikáciách: read, insert s cudzím vlastníkom, update, delete, RPC, download a analýza          |
| Upload     | Malý súbor, hraničná veľkosť, nadlimit, prerušenie, retry, dvojklik, paralelný commit, nesprávny UUID, hash mismatch     |
| WORM       | Pokusy meniť identitu dôkazu, zdroj a audit cez bežné aj privilegované cesty                                             |
| AI         | Neplatný/truncated JSON, podvrhnuté metadata, cudzí zdroj, prompt injection, zlyhanie redakcie, timeout a duplicita jobu |
| Export     | Skutočné PDF, manifest, nezávislý hash, neoverené tvrdenia jasne označené                                                |
| Prevádzka  | Výpadok DB/storage/AI, stale health, nedostupný limiter, reštart workeru, záloha, obnova a rollback                      |

- Destruktívne, záťažové a adversariálne testy iba v izolovanom testovacom prostredí.
- Produkčný smoke používa autorizovaný syntetický testovací prípad, nie existujúce reálne prípady.
- CI musí spustiť typecheck, relevantný lint, celý Vitest, databázové integračné testy, Playwright, secret scan, audit závislostí a Linux image build.
- Kritické scenáre nesmú byť preskočené. Každý ostatný skip musí mať dôvod a vlastníka.
- Pred pilotom overiť minimálne päť súbežných používateľov, 100 súbežných pokusov proti rate limiteru a jednu kompletnú veľkú upload fixture.
- Report obsahuje SHA, image digest, prostredie, čas, počty pass/fail/skip a odkazy na sanitizované dôkazy. Nie iba `exit 0`.

## 5. Nasadenie, prijatie a ďalšie rozširovanie

### Riadené nasadenie

1. Schváliť nový finálny commit a image digest po zelených kontrolách.
2. Overiť kapacitu, zálohy, read-only stav migrácií a kompatibilitu so zdieľanou EvidenceCore.
3. Zaznamenať aktuálny image a konfiguráciu rollbacku.
4. V servisnom okne nasadiť iba aplikáciu; nemení sa celý Docker stack ani databázy.
5. Overiť HTTPS bez vypnutia kontroly certifikátu, verejný stav a ochranu súkromných rout.
6. Vykonať prihlásený upload, serverové overenie, analýzu a export na testovacom prípade.
7. Pri zlyhaní kritického toku obnoviť predchádzajúci image. Databázový rollback nepoužívať ako bežný návrat aplikačnej verzie.
8. Pred reálnymi prípadmi absolvovať 24-hodinové pozorovanie so syntetickými operáciami, funkčnými alertmi a bez kritickej regresie.

### Podmienky „GO pre reálne používanie“

Všetky musia byť splnené:

- Jeden overený release, jeden shell a jeden zodpovedný vykonávateľ nasadenia.
- Žiadny otvorený kritický problém autentifikácie, vlastníctva alebo integrity.
- Reálny úspešný upload vrátane ledgeru, auditu a serverového SHA-256.
- Overené oddelenie používateľov aj pri zápise a cez obe aplikácie.
- AI aj export zachovávajú zdroje a neistotu.
- Funkčné zálohy, preukázaná obnova v dohodnutom limite a použiteľný rollback.
- Dostatočná kapacita, monitoring a doručené testovacie upozornenie.
- Schválené prevádzkové pravidlá a náklady.
- Žiadny kritický test označený `SKIPPED`, `BLOCKED` alebo „neoverené“.

### Čo znamená úplné dokončenie po pilote

Po sedemdňovom stabilnom pilote sa samostatnými bránami sprístupnia ďalšie moduly. Každý modul musí mať používateľský tok, vlastníctvo dát, testy, chybové stavy, monitoring a rollback; nestačí viditeľná položka v menu.

- **Verejný web:** onboarding, ochrana registrácie, kvóty, podpora a kapacitný test.
- **Offline PWA:** bezpečná cache, invalidácia pri odhlásení a explicitné riešenie synchronizačných konfliktov.
- **Electron:** podpísaný inštalátor, izolované IPC, bezpečný update a rollback.
- **Android/iOS:** rovnaké serverové pravidlá, zabezpečené uloženie relácie a platformové regresné testy.
- **Platby a ďalšie integrácie:** samostatné kontraktové a bezpečnostné testy pred zapnutím.

**Aplikácia bude pripravená na produkčné používanie až po splnení prijímacích podmienok, nie po zelenom builde. Tento blueprint je plán; počas jeho prípravy sa nič nenasadilo ani nezmenilo.**
