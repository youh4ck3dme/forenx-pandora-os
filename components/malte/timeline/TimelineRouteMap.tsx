import { Route, MapPin, Scale } from "lucide-react";
import { Card } from "@/components/malte/Shell";
import { Badge } from "@/components/ui/badge";
import type { TimestoryEpisode } from "./types";

interface TimelineRouteMapProps {
  isDemo: boolean;
  episodes: TimestoryEpisode[];
}

export function TimelineRouteMap({ isDemo, episodes }: TimelineRouteMapProps) {
  return (
    <>
      {/* ═══ GEOGRAFICKÁ MAPA TRÁS PRE DYNAMICKÝ SPIS ═══ */}
      {!isDemo ? (
        <Card className="space-y-3 p-4 sm:p-5 border-border/80 bg-card/95 shadow-xl">
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 text-cyan-400" />
            <h4 className="text-sm font-black">Trasy a miesta v aktívnom spise</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            Tento spis neobsahuje predpripravenú mapu. Miesta a trasy uvádzané v časovej osi sú zobrazené výlučne podľa zdrojov jednotlivých udalostí.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set(episodes.map((episode) => episode.location))]
              .filter((location) => location !== "Miesto neuvedené")
              .map((location) => (
                <Badge key={location} variant="outline" className="text-[10px]">
                  <MapPin className="mr-1 h-3 w-3 text-cyan-400" />
                  {location}
                </Badge>
              ))}
          </div>
        </Card>
      ) : null}

      {/* ═══ GEOGRAFICKÉ ROZDELENIE ROLÍ & TELEMETRICKÉ POROVNANIE (DEMO) ═══ */}
      <Card className={`space-y-4 p-4 sm:p-5 border-border/80 bg-card/95 shadow-xl ${isDemo ? "" : "hidden"}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/40 text-[10px] font-bold uppercase flex items-center gap-1">
                <Route className="h-3 w-3" />
                TRASOVACIA FORENZNÁ MAPA
              </Badge>
              <span className="text-xs text-muted-foreground font-semibold">
                D1 Odpočívadlo vs Izolácia v Košiciach
              </span>
            </div>
            <h4 className="text-sm sm:text-base font-black text-foreground">
              Geografické rozdelenie rolí: Kde bol reálne Novák vs kde mizli zbrane
            </h4>
          </div>
          <Badge
            variant="outline"
            className="text-[10px] font-mono border-primary/50 text-primary"
          >
            PPZ-51 // TELEMETRIA & BTS
          </Badge>
        </div>

        {/* 2-stĺpcové porovnanie trás */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ĽAVÁ TRASA: PETER NOVÁK (PASÍVNY ŠTÍT / DOMÁCA IZOLÁCIA) */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <h5 className="font-bold text-xs sm:text-sm text-emerald-400">
                  Peter Novák: Lokálny IT správca (Košice & BB)
                </h5>
              </div>
              <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[9px] font-mono">
                PASÍVNY ŠTÍT
              </Badge>
            </div>

            <p className="text-[11px] text-foreground/80 leading-relaxed">
              Pohyb obvineného bol striktne ohraničený jeho bydliskom a jediným stretnutím v Banskej Bystrici. Vyšetrovací spis neobsahuje jediný dôkaz o jeho prítomnosti na diaľnici D1 ani v sklade v Žiline.
            </p>

            <div className="space-y-2 pt-1">
              <div className="flex items-start gap-2 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
                  1
                </span>
                <div>
                  <strong className="text-foreground text-[11px]">
                    Košice (Trvalé bydlisko & vývoj):
                  </strong>
                  <p className="text-[11px] text-muted-foreground">
                    Tvorba webstránok, občasné vklady hotovosti dodanej Ľubošom v Dunajskej banke, vypnutie telefónu na jar 2025.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
                  2
                </span>
                <div>
                  <strong className="text-foreground text-[11px]">
                    Banská Bystrica (OC Europa, 12/2024):
                  </strong>
                  <p className="text-[11px] text-muted-foreground">
                    Odovzdanie originálu zbrojnej licencie LA 002318 a evidenčných kníh osobe „Ľubo“. Od tohto dňa doklady fyzicky nemal.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 font-bold text-[10px]">
                  ✕
                </span>
                <div>
                  <strong className="text-rose-300 text-[11px]">
                    Žilina (Vysokoškolákov 6):
                  </strong>
                  <p className="text-[11px] text-muted-foreground">
                    Nulová fyzická prítomnosť pri nákupoch. Žiadne BTS dáta nepotvrdzujú jeho prítomnosť v predajni ARMIVEX.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 font-bold text-[10px]">
                  ✕
                </span>
                <div>
                  <strong className="text-rose-300 text-[11px]">
                    Diaľnica D1 & Zahraničie:
                  </strong>
                  <p className="text-[11px] text-muted-foreground">
                    Nulový záznam o jazde, 0 mýtnych transakcií, 0 zahraničných hovorov, nulový medzinárodný roaming.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* PRAVÁ TRASA: DENIS KOVAL & TKÁČ (MEDZINÁRODNÝ TRANZITNÝ KORIDOR) */}
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-rose-500/20 pb-2">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-rose-400 animate-pulse" />
                <h5 className="font-bold text-xs sm:text-sm text-rose-400">
                  Denis Koval & Sieť: Cezhraničný tranzit (D1 ➔ Španielsko)
                </h5>
              </div>
              <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30 text-[9px] font-mono">
                ORGANIZOVANÁ LOGISTIKA
              </Badge>
            </div>

            <p className="text-[11px] text-foreground/80 leading-relaxed">
              Skutočné nákupy, manipuláciu s tovarom a distribúciu vykonával Denis Koval s Miroslavom Tkáčom cez vozidlá BMW 7 a prekládky na nočných diaľničných odpočívadlách.
            </p>

            <div className="space-y-2 pt-1">
              <div className="flex items-start gap-2 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 font-bold text-[10px]">
                  A
                </span>
                <div>
                  <strong className="text-foreground text-[11px]">
                    Bratislava (Nočná kaviareň):
                  </strong>
                  <p className="text-[11px] text-muted-foreground">
                    Naverbovanie IT vývojára Nováka pod zámienkou programovania legálneho zbraňového e-shopu.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 font-bold text-[10px]">
                  B
                </span>
                <div>
                  <strong className="text-foreground text-[11px]">
                    Žilina & PETRIS Nitra:
                  </strong>
                  <p className="text-[11px] text-muted-foreground">
                    Odber zbraní vykonával Koval osobne s Dmitrijom Malinaom a Norbertom Slezákom (Bark Factory Enterprise).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 font-bold text-[10px]">
                  C
                </span>
                <div>
                  <strong className="text-foreground text-[11px]">
                    Diaľnica D1 (Livinské Opatovce / Trenčín):
                  </strong>
                  <p className="text-[11px] text-muted-foreground">
                    Nočné prekládky desiatok kusov zbraní z kufra BMW 7 o 02:00 neznámym odberateľom bez sprievodnej dokumentácie.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 font-bold text-[10px]">
                  D
                </span>
                <div>
                  <strong className="text-foreground text-[11px]">
                    Španielsko (Madrid / Malaga – Europol):
                  </strong>
                  <p className="text-[11px] text-muted-foreground">
                    Záchyt 242 zbraní Guardia Civil v kriminálnom prostredí. Trasovanie potvrdzuje zahraničných kuriérov mimo Nováka.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Súhrnná porovnávacia tabuľka telemetrických dát */}
        <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Scale className="h-3.5 w-3.5 text-primary" /> Telemetrické a procesné porovnanie (Dôkaz neviny):
          </span>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/60 text-[10px] font-mono uppercase text-muted-foreground">
                  <th className="py-1.5 px-2">Forenzné Kritérium</th>
                  <th className="py-1.5 px-2 text-emerald-400">Peter Novák</th>
                  <th className="py-1.5 px-2 text-rose-400">Denis Koval & Sieť</th>
                  <th className="py-1.5 px-2 text-amber-300">Procesný dôsledok pre súd</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 text-[11px]">
                <tr>
                  <td className="py-1.5 px-2 font-semibold">Pohyb na diaľnici D1</td>
                  <td className="py-1.5 px-2 text-emerald-400 font-mono font-bold">
                    0 km / Nulový záznam
                  </td>
                  <td className="py-1.5 px-2 text-rose-400 font-mono">
                    Pravidelné nočné jazdy BMW 7
                  </td>
                  <td className="py-1.5 px-2 text-foreground/80">
                    Novák sa fyzicky nenachádzal na miestach odovzdávania
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 px-2 font-semibold">Lokalizácia mobilu (BTS)</td>
                  <td className="py-1.5 px-2 text-emerald-400 font-mono font-bold">
                    Iba Košice & Banská Bystrica
                  </td>
                  <td className="py-1.5 px-2 text-rose-400 font-mono">
                    Celé územie SR, tranzit D1, zahraničie
                  </td>
                  <td className="py-1.5 px-2 text-foreground/80">
                    Vylučuje prítomnosť Nováka v Žiline v dňoch odberov
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 px-2 font-semibold">Zahraničný roaming & hovory</td>
                  <td className="py-1.5 px-2 text-emerald-400 font-mono font-bold">
                    0 min / 0 kontaktov
                  </td>
                  <td className="py-1.5 px-2 text-rose-400 font-mono">
                    Šifrované hovory, rakúske/španielske linky
                  </td>
                  <td className="py-1.5 px-2 text-foreground/80">
                    Absolútna absencia medzinárodného prvku (§ 115 TP)
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 px-2 font-semibold">Vozidlá a preprava</td>
                  <td className="py-1.5 px-2 text-emerald-400 font-mono font-bold">
                    Nevlastní žiadne motorové vozidlo
                  </td>
                  <td className="py-1.5 px-2 text-rose-400 font-mono">
                    BMW 7, Audi, kuriérske dodávky
                  </td>
                  <td className="py-1.5 px-2 text-foreground/80">
                    Prepravu tovaru technicky nemohol vykonať
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </>
  );
}
