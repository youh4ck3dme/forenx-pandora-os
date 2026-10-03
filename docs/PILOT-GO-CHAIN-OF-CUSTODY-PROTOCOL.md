# PΛND0RΛ / ForenX — Protokol GO pre pilotný release

> Tento dokument je formálnym záznamom GO/NO-GO rozhodnutia pre pilotný release. Plniť ho podľa `docs/BLUEPRINT-PILOT-RELEASE.md` § 5.2.

## Aktuálny stav: `NO-GO`

**Dôvod:** Predpilotné technické podmienky z `docs/BLUEPRINT-PILOT-RELEASE.md` sú nesplnené.

Otvorené blokeры ku dňu 2026-10-03:

| Ref | Blokér | Stav |
|-----|--------|------|
| S-01 | Rotácia secrets | `ROTATION REQUIRED` |
| S-02 | DNS / TLS `pandora.whoiswho.at` | `BLOCKED` |
| S-03 | WebAuthn na produkčnej doméne | `BLOCKED` |
| D-01 | Migrácie na `tlmuvzrgighahnjkxoyw` | `BLOCKED` |
| Z-01 | Supabase PITR | `BLOCKED` |
| Z-02 | Hetzner S3 Object Lock | `BLOCKED` |
| Z-03 | DR drill | `TODO` |
| L-01 | DPIA | `TODO` |
| L-02 | Právny posudok PDF dossier | `TODO` |

---

## Postup pri prechode na GO

1. Splniť všetky podmienky z `BLUEPRINT-PILOT-RELEASE.md` § 3–4.
2. Vyplniť tabuľku GO nižšie.
3. Získať podpisy zodpovedných osôb.
4. Zmeniť stav na `GO` a commitovať.

---

## GO záznam (vyplniť po splnení podmienok)

| Pole | Hodnota |
|------|---------|
| Dátum GO | *(nevyplnené)* |
| Commit HEAD | *(nevyplnené — spustiť `git rev-parse HEAD`)* |
| Overené podmienky | *(nevyplnené — zoznam S-01…L-04)* |
| Technický správca | *(podpis / potvrdenie)* |
| Zodpovedný vyšetrovateľ | *(podpis / potvrdenie)* |
| Právny zástupca | *(podpis / potvrdenie)* |

---

## Zmeny chain-of-custody

| Dátum | Commit | Zmena | Zodpovedný |
|-------|--------|-------|-----------|
| 2026-10-03 | — | Dokument vytvorený; stav NO-GO | youh4ck3dme |

---

*Súvisiaci dokument: `docs/BLUEPRINT-PILOT-RELEASE.md`*
