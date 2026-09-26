import { useState, useEffect, useMemo } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  FileSearch,
  Users,
  Eye,
  Calendar,
  Sparkles,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  MapPin,
  Car,
  Landmark,
  Scale,
  Zap,
  Clock,
  CheckCircle2,
  Copy,
  Check,
  BookOpen,
  Palette,
  Film,
  MessageSquare,
  Flame,
  ArrowRight,
  Play,
  Pause,
  Printer,
  FileText,
  Route,
  Navigation,
  RotateCcw,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/malte/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveCase } from "@/hooks/useActiveCase";
import type {
  ForensicDossier,
  TimelineEvent,
} from "@/lib/forza/types";
import type { ForensicCase } from "@/lib/forza/forensic";

interface AnomalyItem {
  id: number;
  title: string;
  prosecutionClaim: string;
  sourceOfClaim: string;
  forensicTruth: string;
  keyEvidence: string[];
  proceduralAction: string;
  proceduralParagraph: string;
  motionText: string;
  strength: "Nepriestrelné" | "Kritické pre OČTK" | "Rozhodujúci rozpor";
}

interface ComicDialogue {
  speaker: string;
  role: "Novák" | "Koval" | "Ľubo" | "OČTK" | "Hruška" | "Vyšetrovateľ";
  text: string;
}

interface TimestoryEpisode {
  id: number;
  chapterLetter: string;
  date: string;
  badge: string;
  title: string;
  comicImage?: string;
  caption: string;
  narratorBox: string;
  soundEffect: string;
  dialogues: ComicDialogue[];
  comicPrompt: string;
  negativePrompt: string;
  cameraAngle: string;
  forensicAnalysis: string;
  debunkedLie: string;
  involvedActors: string[];
  location: string;
}

const MASTER_COMIC_STYLE_ANCHOR =
  "Graphic novel comic book panel in Frank Miller Sin City noir style. Stark monochrome high-contrast black and white ink drawing, heavy dynamic chiaroscuro shadows, dramatic cross-hatching, accented with vivid splash colors (neon amber, blood crimson, cyan streetlights). Gritty urban Slovak atmosphere, rain-slicked asphalt, cinematic Dutch angles, comic speech balloons and bold yellow narrative caption boxes, 8k resolution graphic novel illustration --ar 16:9 --style raw";

const TIMESTORY_EPISODES: TimestoryEpisode[] = [
  {
    id: 1,
    chapterLetter: "A",
    date: "Máj – December 2024",
    badge: "KAPITOLA A // ZROD SCHRÁNKY",
    title: "Dohoda na zbraňový e-shop & Nastavenie konateľa",
    comicImage: "/timestory/scene1_deal.jpg",
    caption:
      "Bratislava noc. Denis Koval v kaviarni presviedča programátora Petra Nováka na tvorbu e-shopu pre zbrane a prepis firmy VELTRA s.r.o. za 3 000 € mesačne.",
    narratorBox:
      "BRATISLAVA, POLNOC. DYMOM ZAHALENÁ KAVIAREŇ. PROGRAMÁTOR VERÍ, ŽE BUDE IBA KÓDIŤ WEBOVÚ STRÁNKU. NETUŠÍ, ŽE JE NASTAVOVANÝ AKO ŽIVÝ TERČ...",
    soundEffect: "*CVAK-ŤUK... KÓDOVANIE!*",
    dialogues: [
      {
        speaker: "Denis Koval",
        role: "Koval",
        text: "Máš čistý register a zbrojný preukaz. Prepíšeme firmu VELTRA, spravíš moderný e-shop a dám ti 3 000 € mesačne.",
      },
      {
        speaker: "Peter Novák",
        role: "Novák",
        text: "Len web a legálna licencia. Do žiadnej manipulácie so zbraňami ani do terénu nevstúpim.",
      },
    ],
    comicPrompt:
      "Graphic novel comic panel in Frank Miller Sin City style, high contrast noir, deep black inks and dramatic white highlights with vivid amber neon accents. Scene: A dimly lit smoky cafe booth in Bratislava at midnight. Denis Koval, a sharp-dressed Russian-Israeli fixer with slicked-back hair and a sharp leather jacket, leans across the marble table sliding a contract towards Peter Novák, an exhausted young tech developer in a hoodie with a laptop open. Tense expressions, sharp angular shadows, cinematic Dutch angle camera, speech bubble caption space. Masterpiece comic illustration, heavy chiaroscuro line art, 8k resolution --ar 16:9 --style raw",
    negativePrompt:
      "photorealistic, 3d render, blurry, low contrast, oversaturated, messy lines, bad anatomy",
    cameraAngle: "Cinematic Dutch angle, medium two-shot across table",
    forensicAnalysis:
      "Novák ako IT vývojár súhlasil s tvorbou webu a poskytnutím zbrojného preukazu pre licenciu. Skutočnú kontrolu, financovanie a účtovníctvo firmy VELTRA si cez materskú firmu Tavira s.r.o. a sprostredkovateľov ponechal Denis Koval.",
    debunkedLie:
      "Obžaloba tvrdí, že Novák bol hlavným organizátorom. V skutočnosti bol nastavený ako technický správca a štít (biely kôň), zatiaľ čo reálne pokyny dával Koval a neskôr 'Ľubo' z Banskej Bystrice.",
    involvedActors: [
      "Peter Novák (web/konateľ)",
      "Denis Koval (Tavira s.r.o.)",
      "JUDr. Barč / Kostovčíková",
    ],
    location: "Bratislava / Senec",
  },
  {
    id: 2,
    chapterLetter: "B",
    date: "December 2024",
    badge: "KAPITOLA B // FIKTÍVNY SKLAD",
    title: "Vydanie licencie LA 002318 & Okamžité vypratanie trezorov",
    comicImage: "/timestory/scene2_vault.jpg",
    caption:
      "Žilina, Vysokoškolákov 6. Dva masívne trezory boli v miestnosti č. 21 len počas policajnej obhliadky. Hneď po udelení licencie boli bleskovo demontované.",
    narratorBox:
      "ŽILINA, VYSOKOŠKOLÁKOV 6. LEN ČO POLICAJNÁ INŠPEKCIA OTOČÍ KĽÚČOM V ZÁMKU A VYDÁ LICENCIU, ZÁKLADŇA MIZNE BEZ STOPY...",
    soundEffect: "*VŔŔŔZ... BUM!*",
    dialogues: [
      {
        speaker: "'Ľubo' z Banskej Bystrice",
        role: "Ľubo",
        text: "Licencia LA 002318 a knihy sú doma. Trezory zo Žiliny odvezte do hodiny. Odteraz sa žiadna zbraň do skladu nedostane.",
      },
      {
        speaker: "Peter Novák",
        role: "Novák",
        text: "Knihy zbraní a licenciu som ti odovzdal v Banskej Bystrici pred Europou. Kde je tovar?",
      },
    ],
    comicPrompt:
      "Dark graphic novel comic panel, noir style, stark black and white ink drawing with cold cyan and yellow caution tape accents. Scene: An eerie empty commercial storage room in Žilina with bare concrete walls and peeling paint. Two heavy industrial steel gun safes stand with wide-open empty doors, revealing zero weapons inside. On the dusty floor lies a single dropped firearm license certificate stamped 'LA 002318' and an empty folder. A silhouette of a mysterious courier carrying bolt cutters exits through the door into the misty corridor. Dramatic perspective, grit texture, comic book hatching, cinematic wide shot --ar 16:9",
    negativePrompt:
      "color clutter, cartoonish, lowres, flat colors, washed out",
    cameraAngle: "Wide establishing shot with deep linear perspective",
    forensicAnalysis:
      "Novák v Žiline na predajni nikdy nebol ani ju nevybavoval. Prenájom a trezory platil 'Ľubo' z BB. Všetky evidenčné knihy a originál licencie Novák hneď v decembri 2024 odovzdal Ľubošovi pred nákupným centrom Europa v Banskej Bystrici.",
    debunkedLie:
      "Polícia tvrdí, že Novák zatajil sklad a ukradol knihy zbraní. Novák knihami fyzicky nedisponoval od decembra 2024 a keď sa dozvedel o problémoch, sám šiel na políciu požiadať o zrušenie licencie!",
    involvedActors: [
      "'Ľubo' z Banskej Bystrice",
      "Peter Novák",
      "KR PZ Banská Bystrica / Žilina",
    ],
    location: "Žilina (Vysokoškolákov 6) / Banská Bystrica",
  },
  {
    id: 3,
    chapterLetter: "C",
    date: "Január – Marec 2025",
    badge: "KAPITOLA C // HOTOVOSŤ & SMURFING",
    title: "Dunajská banka, vklady v igelitkách a nákupy v ARMIVEXe",
    comicImage: "/timestory/scene3_bank.jpg",
    caption:
      "Pobočka Dunajskej banky. 'Ľubo' nosí hotovosť 15 000 – 30 000 € v balíkoch a čaká vonku v aute. Novák robí mechanické vklady a prevod záloh na ARMIVEX.",
    narratorBox:
      "DUNAJSKÁ BANKA. PAPIEROVÉ TAŠKY PLNE NEPOCHOPITEĽNÝCH PEŇAZÍ. NOVÁK VKLADÁ 106 000 € ZA PÁR DNÍ, ZATIAĽ ČO ČIERNE AUDI VONKU NIKDY NEVYPÍNA MOTOR...",
    soundEffect: "*ŠUCHOT... CH-CHING!*",
    dialogues: [
      {
        speaker: "'Ľubo' z BB",
        role: "Ľubo",
        text: "Tu máš 25-tisíc v hotovosti. Vlož to na účet VELTRA a ihneď pošli zálohu do ARMIVEXu na tie Glocky. Ja čakám v Audi.",
      },
      {
        speaker: "Peter Novák",
        role: "Novák",
        text: "Odkiaľ sú tie peniaze? Ja o tých zbraniach nič neviem, ani aká je marža!",
      },
      {
        speaker: "'Ľubo' z BB",
        role: "Ľubo",
        text: "Nestaraj sa. Rob si svoju administratívu a dostaneš výplatu.",
      },
    ],
    comicPrompt:
      "Noir graphic novel style comic strip panel, Frank Miller style, heavy black shadows, emerald green and gold accents. Scene: Inside a modern Tatra bank branch counter. A nervous young man (Peter Novák) standing at the teller counter depositing thick stacks of 100-euro banknotes out of an ordinary plastic shopping bag. Through the large glass window in the dark rainy background, a sinister man ('Ľubo') wearing a dark hood and aviator shades watches him while sitting behind the steering wheel of an idling dark Audi. High contrast, atmospheric noir lighting, tense comic book storytelling, crisp ink line work --ar 16:9",
    negativePrompt: "bright day, cheerful, blurry, watercolor, anime",
    cameraAngle:
      "Over-the-shoulder medium shot inside bank looking through window",
    forensicAnalysis:
      "Novák nepoznal marže, dodacie listy ani koncové ceny. Zálohové faktúry ARMIVEXu platil z peňazí dodaných Ľubošom. Zbrane v Žiline osobne nepreberal — odberateľom bol neznámy muž v Audi disponujúci Novákovými prefotenými dokladmi a zbrojnou licenciou.",
    debunkedLie:
      "Hruškovo tvrdenie, že Novák prišiel 3x osobne po 242 zbraní, je rozporné: Hruška si sám nepamätá miesto odovzdania (na sklade vs v meste), chýba grafologický posudok podpisov a chýbajú kamerové záznamy.",
    involvedActors: [
      "'Ľubo' z BB (zdroj hotovosti)",
      "Peter Novák (vkladateľ)",
      "Marek Hruška (ARMIVEX s.r.o.)",
    ],
    location: "Košice / Žilina (Kvačalova)",
  },
  {
    id: 4,
    chapterLetter: "D",
    date: "Jar 2025",
    badge: "KAPITOLA D // ROZPAD DÔVERY",
    title: "Zadržanie peňazí za prácu & Vypnutie telefónu",
    comicImage: "/timestory/scene4_cutoff.jpg",
    caption:
      "Novák zisťuje, že z neho robia štít a neplatia dohodnutú odmenu. Z prijatých peňazí si strhne 6 000 – 9 000 € a vypína telefón. Ľubo zúri a odchádza do Thajska.",
    narratorBox:
      "KOŠICE, 03:00 RÁNO. STUDENÝ NOČNÝ DÁŽĎ. ZÚFALSTVO PREMÁHA STRACH. ZLOMENÁ SIM KARTA LETÍ DO KANÁLA...",
    soundEffect: "*CVAK... CRACK!*",
    dialogues: [
      {
        speaker: "Peter Novák",
        role: "Novák",
        text: "Dlhujete mi 9 000 € za tri mesiace. Nevyplatili ste ma, hádžete na mňa svoje kšefty. Beriem svoje peniaze a končím. Nikdy viac mi nevolajte!",
      },
      {
        speaker: "Denis Koval",
        role: "Koval",
        text: "Si mŕtvy muž, Erik! Nevieš, komu si skrížil cestu. Zničím ťa!",
      },
    ],
    comicPrompt:
      "Gritty graphic novel comic panel, intense noir comic art with vivid crimson red splash color and pitch black shadows. Scene: A rainy, desolate street corner in Košice at 3:00 AM under a single flickering sodium streetlamp. Peter Novák, drenched in rain with eyes wide with panic and fear, is snapping a cheap prepaid burner smartphone in half, popping out the SIM card and throwing it into a sewer grate. In his other hand he tightly clutches a soaked backpack containing 6,000 euros. Rain streaks cutting through the gloom, dramatic close-up side angle, comic sound effect *SNAP!*, heavy ink hatching --ar 16:9",
    negativePrompt:
      "sunny, happy, soft digital painting, flat lighting, low contrast",
    cameraAngle:
      "Low-angle dramatic close-up on hands breaking phone with rain splashes",
    forensicAnalysis:
      "Tento kľúčový moment jednoznačne dokazuje, že Novák nebol spolupáchateľom v deľbe ziskov. Člen organizovaného gangu nekradne vlastnej skupine peniaze a nevypína si mobil. Zúfalý krok znamenal totálny kolaps kontaktu s Ľubošom a Kovalom.",
    debunkedLie:
      "OČTK interpretuje zadržané peniaze ako 'zisk z trestnej činnosti'. V skutočnosti išlo o jednostranné započítanie nevyplatenej mzdy a definitívny útek Nováka zo spolupráce.",
    involvedActors: ["Peter Novák", "'Ľubo' (odlet do Thajska)", "Denis Koval"],
    location: "Košice / Banská Bystrica",
  },
  {
    id: 5,
    chapterLetter: "E",
    date: "Leto – Jeseň 2025",
    badge: "KAPITOLA E // NOČNÁ LOGISTIKA",
    title: "Denis Koval, PETRIS Nitra a nočné odpočívadlo Livinské Opatovce",
    comicImage: "/timestory/scene5_transit.jpg",
    caption:
      "Nočné odpočívadlo D1 Livinské Opatovce o 02:00. Denis Koval otvára zvnútra kufor BMW 7, neznámy muž preberá čiernu tašku s desiatkami pištolí Glock.",
    narratorBox:
      "DIAĽNICA D1, ODPOČÍVADLO LIVINSKÉ OPATOVCE. 02:15. HMLISTÁ TMA. KUFOR LUXUSNÉHO BMW SA OTVÁRA ZVNÚTRA. PREVZATIE BEZ JEDINÉHO SLOVA...",
    soundEffect: "*ŠKRÍÍÍP-CVAK!*",
    dialogues: [
      {
        speaker: "Denis Koval",
        role: "Koval",
        text: "Tu je 40 kusov. Čisté, vymazané čísla z Armivexu a Bark Factory. Hneď to presuňte cez hranice.",
      },
      {
        speaker: "Kuriér siete",
        role: "OČTK",
        text: "A čo ten IT chalan z Košíc? Nebude hovoriť?",
      },
      {
        speaker: "Denis Koval",
        role: "Koval",
        text: "Ten ani nevie, čo je D1. Všetky papiere sú na jeho meno, on ponesie následky.",
      },
    ],
    comicPrompt:
      "High contrast noir comic book panel, Frank Miller Sin City graphic novel art, midnight blue and bright halogen headlight beams. Scene: An abandoned highway rest stop along the Slovak D1 highway at 2:00 AM. Denis Koval in a dark trench coat standing by the popped open trunk of a sleek luxury BMW 7 series, passing heavy black tactical duffel bags filled with Glock handguns to a mysterious shadowy contact in a leather jacket. Fog rising from the asphalt, dramatic silhouette lighting, deep shadows, cinematic comic composition, comic caption box overlay --ar 16:9",
    negativePrompt: "daytime, colorful cartoon, flat digital, overexposed",
    cameraAngle:
      "Cinematic wide shot with piercing car headlights slicing through darkness",
    forensicAnalysis:
      "Skutočnú distribúciu a odovzdávanie zbraní mimo evidenciu riadil Denis Koval podľa inštrukcií Miroslava Tkáča. Keď VELTRA odmietli, Koval zapojil firmu Bark Factory Enterprise cez Norberta Slezáka. Novák o týchto prevozoch nemal žiadnu vedomosť.",
    debunkedLie:
      "Tvrdenie, že Novák bol v PETRIS Nitra v šiltovke, vyvracia sám Koval — do Nitry chodil s Dmitrijom Malinaom a Slezákom. Novák bol v tom čase preukázateľne v Košiciach.",
    involvedActors: [
      "Denis Koval (šofér/prevozy)",
      "Miroslav Tkáč",
      "Norbert Slezák",
      "Michal Ondruš",
    ],
    location: "Odpočívadlo D1 Livinské Opatovce / Trenčín",
  },
  {
    id: 6,
    chapterLetter: "F",
    date: "2026",
    badge: "KAPITOLA F // ZÁSAH V ŠPANIELSKU",
    title: "Záchyt zbraní v Španielsku & Absencia medzinárodného spojenia",
    comicImage: "/timestory/scene6_seizure.jpg",
    caption:
      "Španielska Guardia Civil a EUROPOL zaisťujú Glock 19 (CGDV051) a Grand Power K100 v kriminálnom podsvetí. Trasovanie vedie na Slovensko.",
    narratorBox:
      "MADRID – BANSKÁ BYSTRICA. FORENZNÉ LABORATÓRIUM. POLÍCIA ZOBRAZUJE MAPU KLANU. NOVÁK JE LEN MŔTVYM BODOM NA KONCI REŤAZCA...",
    soundEffect: "*POLICAJNÉ SIRÉNY // VZÁJOMNÉ ZAISTENIE!*",
    dialogues: [
      {
        speaker: "Španielska Guardia Civil",
        role: "OČTK",
        text: "Zbrane zadržané v Španielsku majú sériové čísla z dodávky pre VELTRA s.r.o. Kto organizoval transport?",
      },
      {
        speaker: "Vyšetrovateľ ÚBOK",
        role: "Vyšetrovateľ",
        text: "Na papieri je konateľ Novák. V realite nemáme žiadne jeho hovory do zahraničia, žiadny roaming, žiadne peniaze. Iba Kovala a Tkáča na diaľniciach.",
      },
    ],
    comicPrompt:
      "Dramatic noir graphic novel comic panel, stark monochrome ink with flashing police red and blue emergency beacon lighting. Scene: A forensic police crime lab in Spain / Europol evidence room. Heavy evidence tables displaying dozens of seized Glock 19 and Grand Power pistols with forensic evidence tags. In the background, a large bulletin board shows crime network connection lines tracing from Koval and Tkáč across Europe, while Peter Novák's photo is at the dead-end bottom as an exploited shell. Dramatic high angle perspective, gritty comic book inks, stark shadows, cinematic finale panel --ar 16:9",
    negativePrompt: "blurry, low quality, sketch, amateur drawing, anime",
    cameraAngle:
      "High-angle panoramic view over evidence table into background network map",
    forensicAnalysis:
      "Balistická zhoda potvrdzuje pôvod zbraní, no Novák nemá žiadne zahraničné kontakty, jazykové schopnosti ani väzby na Balkánsku trasu. Medzinárodný odbyt organizovala sieť okolo Tkáča a Kovala, ktorí disponovali vozidlami s rakúskymi a zahraničnými prepojeniami.",
    debunkedLie:
      "Obžaloba pripisuje vývoz do Španielska Novákovi len na základe licencie. V spise neexistuje jediný dôkaz (hovor, SMS, roaming, svedok), ktorý by Nováka spájal so zahraničnou distribúciou.",
    involvedActors: [
      "Guardia Civil / EUROPOL",
      "Kriminalistický ústav PZ",
      "Denis Koval / M. Tkáč",
    ],
    location: "Španielske kráľovstvo / Banská Bystrica (ÚBOK)",
  },
];

const ANOMALIES_DATA: AnomalyItem[] = [
  {
    id: 1,
    title: "Osobný odber 242 zbraní v ARMIVEXe Žilina",
    prosecutionClaim:
      "Svedok Marek Hruška (DOKAZ_09) tvrdí, že Peter Novák chodil po zbrane v Audi, 3x ukázal OP a licenciu a zbrane podpísal v knihe.",
    sourceOfClaim: "Zápisnica o výsluchu svedka M. Hrušku (ARMIVEX s.r.o.)",
    forensicTruth:
      "Klamstvo svedka Hrušku snažiaceho sa získať štatút chráneného oznamovateľa. Dokladmi (licencia, prefotený OP) fyzicky disponoval Koval a Ľubo. Hruška si sám nepamätá miesto odovzdania (na sklade vs v meste!). Novák v Žiline nikdy nebol.",
    keyEvidence: [
      "Hruška si nepamätá miesto odovzdania (DOKAZ_09, s. 7)",
      "Zbrojnú licenciu aj knihy mal od 12/2024 Ľubo a Koval",
      "Kamerové záznamy predajne neexistujú",
    ],
    proceduralAction:
      "Nariadiť písmoznalecký posudok podpisov a BTS lokalizáciu mobilu Nováka v dňoch nákupov.",
    proceduralParagraph: "§ 142 TP (Písmoznalectvo) & § 125 TP (Konfrontácia)",
    motionText: `NÁVRH NA VYKONANIE DÔKAZU (§ 142 A § 125 TRESTNÉHO PORIADKU)
Vec: ČVS: PPZ-51/ÚBOK-PZ-ST-2025 (KAUZA ARMIVEX / VELTRA)
Obvinený: Peter Novák
Adresát: Úrad boja proti organizovanej kriminalite Prezídia PZ / Špecializovaný trestný súd

V zmysle § 119 a nasl. Trestného poriadku navrhujem vykonať nasledovné dokazovanie:
1. Nariadiť znalecké dokazovanie z odboru písmoznalectva (§ 142 TP) za účelom preskúmania pravosti podpisov v evidenčných knihách zbraní spoločnosti ARMIVEX s.r.o. a na výdajových dokladoch oproti porovnávacím vzorkám podpisu obvineného Petra Nováka.
2. Nariadiť a vykonať konfrontáciu podľa § 125 TP medzi obv. Petrom Novákom a svedkom Marekom Hruškom k rozporom v mieste, čase a spôsobe údajného odovzdania 242 zbraní (Hruška uvádza odber v sklade, v meste aj mimo neho).
3. Vyžiadať BTS lokalizačné údaje k telefónnemu číslu obvineného v dňoch údajných nákupov na vylúčenie jeho fyzickej prítomnosti v Žiline.

Odôvodnenie: Svedok Hruška si zabezpečuje vlastnú beztrestnosť a jeho tvrdenia sú v priamom rozpore s technickými dôkazmi a výpoveďami spoluobvinených.`,
    strength: "Rozhodujúci rozpor",
  },
  {
    id: 2,
    title: "Návšteva PETRIS Nitra ('Novák v šiltovke') a telefonát",
    prosecutionClaim:
      "Svedok Michal Ondruš tvrdí, že v 08/2025 prišiel Koval s Novákom v šiltovke a Novák mu telefonicky potvrdil prevzatie.",
    sourceOfClaim: "Výpoveď svedka Michala Ondruša (PETRIS-SLOVAKIA s.r.o.)",
    forensicTruth:
      "Koval v DOKAZ_08 výslovne potvrdzuje, že v Nitre bol s Dmitrijom Malinaom a neskôr cez Norberta Slezáka. Novák v tom čase žil v Košiciach a o nákupoch v PETRIS nevedel. Ondrušovi priniesol prefotené doklady Koval.",
    keyEvidence: [
      "Koval potvrdzuje, že v Nitre bol s Malinaom a Slezákom (DOKAZ_08, s. 8-10)",
      "Neuskutočnila sa žiadna zákonná rekognícia (§ 126 TP)",
      "Novák v inkriminovanom čase preukázateľne býval v Košiciach",
    ],
    proceduralAction:
      "Vyžiadať telekomunikačné záznamy hovorov medzi číslami Ondruša a Nováka.",
    proceduralParagraph: "§ 116 TP (Dáta z telekomunikačnej prevádzky)",
    motionText: `NÁVRH NA VYKONANIE DÔKAZU (§ 116 A § 126 TRESTNÉHO PORIADKU)
Vec: ČVS: PPZ-51/ÚBOK-PZ-ST-2025 (KAUZA PETRIS NITRA)
Obvinený: Peter Novák
Adresát: Úrad boja proti organizovanej kriminalite Prezídia PZ

Navrhujem vykonať nasledovné dokazovanie:
1. Zabezpečiť prevádzkové telekomunikačné údaje (§ 116 TP) – zoznam prichádzajúcich a odchádzajúcich hovorov a SMS medzi číslom svedka Michala Ondruša a číslom obv. Nováka za august 2025 na vyvrátenie tvrdenia o telefonickom potvrdení odberu tovaru.
2. Vykonať zákonnú rekogníciu podľa § 126 TP za účasti svedka Michala Ondruša in natura s figurantmi podobného veku a postavy.
3. Konfrontovať svedka Ondruša s výpoveďou Denisa Kovala (DOKAZ_08, s. 8-10), ktorý potvrdil, že do PETRIS chodil s Malinaom a Slezákom a nie s Novákom.

Odôvodnenie: Tvrdenie o „mužovi v šiltovke“ je nepodloženou domnienkou. Obvinený v inkriminovanom čase žil v Košiciach a nákupy v PETRIS neorganizoval.`,
    strength: "Kritické pre OČTK",
  },
  {
    id: 3,
    title: "Vklady hotovosti 106 000 € na účet VELTRA s.r.o. v Dunajskej banke",
    prosecutionClaim:
      "Novák ako jediný štatutár vkladal státisíce eur v hotovosti a autorizoval platby za zbrane.",
    sourceOfClaim: "Bankové výpisy z Dunajskej banky a.s. a pokladničné lístky",
    forensicTruth:
      "Klasický model bieleho koňa a smurfingu: hotovosť fyzicky prinášal koordinátor 'Ľubo' z BB, ktorý čakal pred bankou a diktoval sumy. Novák nepoznal zmluvné marže, dodacie listy ani špecifikácie zbraní.",
    keyEvidence: [
      "Novák presne popísal vkladové schôdzky s Ľubošom (DOKAZ_07, s. 7-8)",
      "Vklady boli vykonávané len pár hodín pred splatnosťou zálohových faktúr",
      "Novák nemal prístup k ziskom z predaja zbraní",
    ],
    proceduralAction:
      "Zaistiť kamerové záznamy pobočiek Dunajskej banky dokumentujúce prítomnosť osoby 'Ľubo'.",
    proceduralParagraph:
      "§ 119 ods. 1 písm. f) TP (Preukázanie pôvodu a tokov)",
    motionText: `NÁVRH NA VYKONANIE DÔKAZU (§ 119 ODS. 1 PÍSM. F) TRESTNÉHO PORIADKU)
Vec: ČVS: PPZ-51/ÚBOK-PZ-ST-2025 (VKLADY V TATRA BANKE)
Obvinený: Peter Novák
Adresát: ÚBOK Prezídia PZ / Dozorujúci prokurátor ÚŠP

Navrhujem vykonať nasledovné dokazovanie:
1. Zaistiť a vyhodnotiť kamerové záznamy z vonkajších priestorov pobočiek Dunajskej banky (Košice / Banská Bystrica) v dňoch a časoch vykonania vkladov hotovosti na účet VELTRA s.r.o.
2. Zabezpečiť identifikáciu motorového vozidla značky Audi a osoby „Ľubo“ z Banskej Bystrice, ktorá pred bankou čakala s bežiacim motorom a hotovosť obvinenému fyzicky odovzdávala.
3. Vyžiadať auditné logy bankových prevodov a zálohových faktúr preukazujúce, že Novák disponoval iba sumami určenými na okamžitý prevod pre dodávateľa bez dispozície so ziskom.

Odôvodnenie: Tieto dôkazy preukážu klasickú rolu nastrčeného technického administrátora (bieleho koňa) a vylúčia organizátorskú rolu obvineného.`,
    strength: "Nepriestrelné",
  },
  {
    id: 4,
    title: "Ponechanie si peňazí (6 000 – 9 000 €) a 'vypnutie sa'",
    prosecutionClaim:
      "Novák čerpal zisk z kriminálnej činnosti, keď si ponechal časť peňazí z firemného účtu.",
    sourceOfClaim: "Výpoveď Petra Nováka (DOKAZ_07, s. 8)",
    forensicTruth:
      "Dôkaz rozpadu vzťahu a absencie organizovanej skupiny: Novákovi neplatili sľúbenú odmenu 3 000 €/mes., preto si v zúfalstve započítal 3 mesačné odmeny a vypol telefón. Člen gangu nekradne vlastným šéfom.",
    keyEvidence: [
      "Po zadržaní peňazí 'Ľubo' odletel do Thajska a komunikácia skončila",
      "Novák zablokoval ďalšie prevody a odstrihol sa od skupiny",
      "Koval sa mu vyhrážal tvrdými dôsledkami (DOKAZ_07, s. 8)",
    ],
    proceduralAction:
      "Doložiť výpisy súkromných účtov a komunikáciu potvrdzujúcu ukončenie stykov na jar 2025.",
    proceduralParagraph: "§ 119 TP (Subjektívna stránka a motív)",
    motionText: `NÁVRH NA VYKONANIE DÔKAZU (§ 119 TRESTNÉHO PORIADKU – SUBJEKTÍVNA STRÁNKA)
Vec: ČVS: PPZ-51/ÚBOK-PZ-ST-2025 (ROZPAD DÔVERY A ÚTEK OBVINENÉHO)
Obvinený: Peter Novák
Adresát: Špecializovaný trestný súd / ÚBOK PZ

Navrhujem vykonať nasledovné dokazovanie:
1. Vyhodnotiť elektronickú komunikáciu (aplikácie WhatsApp, Signal) z jari 2025 preukazujúcu vyhrážky Denisa Kovala voči obvinenému po tom, čo si jednostranne započítal nevyplatenú odmenu a vypol telefón.
2. Preveriť cestovné a letové záznamy osoby „Ľubo“ dokumentujúce jeho odlet do Thajska bezprostredne po kolapse komunikácie s Novákom.
3. Založiť výpisy zo súkromných účtov obvineného dokumentujúce, že od jari 2025 nedisponoval žiadnymi financiami zo zbraňových obchodov.

Odôvodnenie: Konanie obvineného preukazuje totálny rozpad vzťahu so skupinou. Člen organizovanej skupiny si jednostranne nezapočítava peniaze, nevypína komunikáciu a neuteká pred vlastnými partnermi.`,
    strength: "Nepriestrelné",
  },
  {
    id: 5,
    title: "Zmiznutie evidenčnej knihy zbraní a fiktívny sklad v Žiline",
    prosecutionClaim:
      "Novák maril policajnú kontrolu tým, že neodovzdal knihu zbraní a demontoval trezory na Vysokoškolákov.",
    sourceOfClaim: "Zistenie oddelenia dokladov KR PZ Žilina / Banská Bystrica",
    forensicTruth:
      "Fyzická nemožnosť plnenia: Novák knihu nemal, odovzdal ju hneď v 12/2024 Ľubošovi. Nájom v Žiline platil Ľubo. Kľúčové: Akonáhle Novák zistil nezrovnalosti, sám šiel na políciu požiadať o zrušenie licencie!",
    keyEvidence: [
      "Žiadosť o zrušenie licencie podaná samotným Novákom",
      "Vrátenie osobného zbrojného preukazu Novákom",
      "Trezory zabezpečovala a demontovala tretia osoba ('Ľubo')",
    ],
    proceduralAction:
      "Vypočuť prenajímateľa priestorov na ul. Vysokoškolákov 6 k osobe, ktorá platila nájom a kľúče.",
    proceduralParagraph: "§ 131 TP (Výsluch svedka — prenajímateľ priestorov)",
    motionText: `NÁVRH NA VYKONANIE DÔKAZU (§ 131 TRESTNÉHO PORIADKU)
Vec: ČVS: PPZ-51/ÚBOK-PZ-ST-2025 (SKLAD VYSOKOŠKOLÁKOV 6, ŽILINA)
Obvinený: Peter Novák
Adresát: ÚBOK Prezídia PZ

Navrhujem vykonať nasledovné dokazovanie:
1. Predvolať a vypočuť ako svedka prenajímateľa nebytových priestorov na ul. Vysokoškolákov 6 v Žiline k osobe, ktorá reálne platila nájomné, disponovala kľúčmi a zabezpečila montáž a demontáž dvoch trezorov.
2. Založiť do spisu spisový materiál KR PZ Žilina a Banská Bystrica o dobrovoľnom vrátení zbrojného preukazu a žiadosti o zrušenie zbrojnej licencie LA 002318 podanej obvineným.
3. Vypočuť príslušníkov PZ, ktorí vykonávali prvotnú kontrolu skladu pred vydaním licencie.

Odôvodnenie: Obvinený v Žiline po vydaní licencie nikdy nebol, kľúče ani trezory nespravoval a pri zistení podozrení sám bezodkladne konal voči polícii.`,
    strength: "Rozhodujúci rozpor",
  },
  {
    id: 6,
    title: "Zbrane zaistené v Španielsku (Europol)",
    prosecutionClaim:
      "Novák ako konateľ zodpovedá za medzinárodný nelegálny transfer zbraní do kriminálneho prostredia.",
    sourceOfClaim: "Správa národnej ústredne EUROPOL zo dňa 06.02.2026",
    forensicTruth:
      "Absolútna absencia medzinárodného prvku u Nováka: nemá jazykové znalosti, kontakty ani vozidlá. Zbrane z kufrov áut na odpočívadlách D1 fyzicky odovzdával Denis Koval napojený na Miroslava Tkáča.",
    keyEvidence: [
      "Žiadna cezhraničná komunikácia (SMS, roaming, hovory)",
      "Novák nikdy nevlastnil ani neviedol motorové vozidlá skupiny",
      "Výpovede Kovala o preberaní tovaru cez rakúske a španielske kontakty",
    ],
    proceduralAction:
      "Dožiadať kompletné dáta o medzinárodnom sledovaní od EUROPOLu k identifikácii šoférov.",
    proceduralParagraph:
      "§ 115 TP (Záznam o telekomunikačnej a dopravnej prevádzke)",
    motionText: `NÁVRH NA MEDZINÁRODNÉ JUSTIČNÉ DOŽIADANIE (§ 115 TP & ZÁK. Č. 650/2005 Z. Z.)
Vec: ČVS: PPZ-51/ÚBOK-PZ-ST-2025 (ZÁSAH EUROPOL V ŠPANIELSKU)
Obvinený: Peter Novák
Adresát: Špecializovaný trestný súd / Generálna prokuratúra SR

Navrhujem vykonať nasledovné dokazovanie:
1. Formou Európskeho vyšetrovacieho príkazu (EIO) dožiadať od španielskej Guardia Civil a EUROPOLu zoznam zadržaných vozidiel, vodičov a kuriérov na trase do Španielska.
2. Vyžiadať lokalizačné a mýtne záznamy vozidiel BMW 7 a Audi používaných Dimitrim Kovalom a Miroslavom Tkáčom k identifikácii nočných prekládok na diaľnici D1.
3. Vykonať analýzu roamingových dát obvineného preukazujúcu, že obvinený nemal žiadne medzinárodné spojenie, roamingové hovory ani kontakt so zahraničnými subjektmi.

Odôvodnenie: Pripisovanie medzinárodného obchodu obvinenému bez jediného zahraničného kontaktu je právne neudržateľné a odporuje zásade in dubio pro reo (§ 2 ods. 10 TP).`,
    strength: "Nepriestrelné",
  },
];

function formatTimestoryDate(value: string) {
  const parsed = new Date(value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("sk-SK", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

function actorNames(event: string, forensicCase: ForensicCase) {
  const matches = forensicCase.entities
    .filter((entity) => event.toLocaleLowerCase().includes(entity.name.toLocaleLowerCase()))
    .map((entity) => `${entity.name} (${entity.role})`);
  return matches.length > 0 ? matches : ["Aktéri uvedení v spise"];
}

export function buildDynamicEpisodes(
  forensicCase: ForensicCase,
  dossier: ForensicDossier,
): TimestoryEpisode[] {
  const timeline: TimelineEvent[] =
    dossier.facts.timeline.length > 0
      ? dossier.facts.timeline
      : forensicCase.events.map((event) => ({
          time: event.date,
          event: `${event.title}: ${event.detail}`,
          source: "Evidencia prípadu",
          chainBreak: false,
          severity:
            event.severity === "critical"
              ? "critical"
              : event.severity === "high" || event.severity === "medium"
                ? "warning"
                : "info",
        }));

  const sourceTimeline =
    timeline.length > 0
      ? timeline
      : [
          {
            time: forensicCase.referenceDate,
            event: "Spis zatiaľ neobsahuje udalosti časovej osi.",
            source: "Doplňte udalosti alebo spustite Autopilota nad dokumentom.",
            chainBreak: false,
            severity: "info" as const,
          },
        ];

  return sourceTimeline.slice(0, 12).map((event, index) => {
    const chapterLetter = String.fromCharCode(65 + index);
    const source = event.source || "Zdroj nie je uvedený";
    const isBreak = event.chainBreak === true;
    return {
      id: index + 1,
      chapterLetter,
      date: formatTimestoryDate(event.time),
      badge: `KAPITOLA ${chapterLetter} // ${isBreak ? "VYŽADUJE OVERENIE" : "UDALOSŤ SPISU"}`,
      title: event.event,
      caption: `Zdroj: ${source}`,
      narratorBox: `${formatTimestoryDate(event.time)} · ${source}`,
      soundEffect: isBreak ? "*POZOR — MEDZERA*" : "*ZÁZNAM V SPISE*",
      dialogues: [
        {
          speaker: "Záznam v spise",
          role: "Vyšetrovateľ",
          text: event.event,
        },
      ],
      comicPrompt: `${MASTER_COMIC_STYLE_ANCHOR} Scene based strictly on this documented case event: ${event.event}. Do not add people, objects, or facts absent from the source.`,
      negativePrompt:
        "invented persons, invented evidence, photorealistic, 3d render, blurry",
      cameraAngle: "Dokumentárny panel podľa zdrojovej udalosti",
      forensicAnalysis: `${event.event} (Zdroj: ${source})`,
      debunkedLie: isBreak
        ? `Procesná neistota: ${event.paragraph ?? "reťazec zabezpečenia alebo zdroj treba doplniť."}`
        : "Udalosť je pracovný záznam zo spisu a vyžaduje overenie v pôvodnom dokumente.",
      involvedActors: actorNames(event.event, forensicCase),
      location: event.sourceRef?.label || event.source || "Miesto neuvedené",
    };
  });
}

export function buildDynamicAnomalies(dossier: ForensicDossier): AnomalyItem[] {
  const contradictions = (dossier.testimonyContradictions ?? []).map(
    (item, index) => ({
      id: index + 1,
      title: item.topic,
      prosecutionClaim: item.personA.claim,
      sourceOfClaim: item.personA.name,
      forensicTruth: item.factualRecord,
      keyEvidence: item.personB ? [item.personB.claim] : [],
      proceduralAction: item.proceduralResolution,
      proceduralParagraph: "Procesný postup zo spisu",
      motionText: item.proceduralResolution,
      strength:
        item.contradictionSeverity === "critical"
          ? ("Rozhodujúci rozpor" as const)
          : ("Kritické pre OČTK" as const),
    }),
  );
  const defects = (dossier.admissibilityAudit?.defects ?? []).map(
    (defect, index) => ({
      id: contradictions.length + index + 1,
      title: defect.description,
      prosecutionClaim: "Procesná použiteľnosť dôkazu vyžaduje preskúmanie.",
      sourceOfClaim: defect.paragraph,
      forensicTruth: defect.description,
      keyEvidence: [defect.remedyAction],
      proceduralAction: defect.remedyAction,
      proceduralParagraph: defect.paragraph,
      motionText: defect.remedyAction,
      strength:
        defect.severity === "critical"
          ? ("Rozhodujúci rozpor" as const)
          : ("Kritické pre OČTK" as const),
    }),
  );
  const flows = (dossier.financialAnalysis?.suspiciousFlows ?? []).map(
    (flow, index) => ({
      id: contradictions.length + defects.length + index + 1,
      title: `${flow.payer} → ${flow.recipient}`,
      prosecutionClaim: flow.redFlag,
      sourceOfClaim: `${flow.date} · ${flow.id}`,
      forensicTruth: flow.purpose,
      keyEvidence: [`${flow.amount.toLocaleString("sk-SK")} EUR`, flow.redFlag],
      proceduralAction: "Overiť pôvod a účel platby v prvotných dokladoch.",
      proceduralParagraph: "§ 119 TP",
      motionText: `Overiť transakciu ${flow.id}: ${flow.purpose}`,
      strength: "Kritické pre OČTK" as const,
    }),
  );
  return [...contradictions, ...defects, ...flows];
}

export function TruthTimestorySection() {
  const { activeCase, dossier } = useActiveCase();
  const isDemo = dossier?.analysisMeta?.isDemo === true;
  const episodes = useMemo(
    () =>
      isDemo || !dossier
        ? TIMESTORY_EPISODES
        : buildDynamicEpisodes(activeCase, dossier),
    [activeCase, dossier, isDemo],
  );
  const anomalies = useMemo(
    () => (isDemo || !dossier ? ANOMALIES_DATA : buildDynamicAnomalies(dossier)),
    [dossier, isDemo],
  );
  const caseTitle = dossier?.caseTitle || activeCase.name;
  const [activeEpisodeId, setActiveEpisodeId] = useState<number>(1);
  const [expandedAnomalyId, setExpandedAnomalyId] = useState<number | null>(1);
  const [filterStrength, setFilterStrength] = useState<string>("all");
  const [copiedPromptId, setCopiedPromptId] = useState<number | null>(null);
  const [copiedMotionId, setCopiedMotionId] = useState<number | null>(null);
  const [expandedMotionId, setExpandedMotionId] = useState<number | null>(null);
  const [copiedAllPrompts, setCopiedAllPrompts] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Record<number, boolean>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);

  useEffect(() => {
    if (!episodes.some((episode) => episode.id === activeEpisodeId)) {
      setActiveEpisodeId(episodes[0]?.id ?? 1);
    }
  }, [activeEpisodeId, episodes]);

  useEffect(() => {
    if (!isPlaying) {
      setPlayProgress(0);
      return;
    }

    const intervalMs = 80;
    const durationMs = 6000;
    const step = (intervalMs / durationMs) * 100;

    const timer = setInterval(() => {
      setPlayProgress((prev) => {
        if (prev >= 100) {
          setActiveEpisodeId((curr) =>
            curr >= episodes.length ? 1 : curr + 1,
          );
          return 0;
        }
        return prev + step;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying]);

  function togglePlaySlideshow() {
    setIsPlaying((prev) => {
      const next = !prev;
      if (next) {
        toast.info("🎬 Filmový pás spustený: automatický posun o 6 sekúnd");
      }
      return next;
    });
  }

  function handleCopyMotion(anomaly: AnomalyItem) {
    void navigator.clipboard.writeText(anomaly.motionText).then(
      () => {
        setCopiedMotionId(anomaly.id);
        toast.success(
          `Oficiálny procesný návrh pre Anomáliu ${anomaly.id} skopírovaný do schránky!`,
        );
        setTimeout(() => setCopiedMotionId(null), 2500);
      },
      () => {
        toast.error("Kopírovanie do schránky zlyhalo.");
      },
    );
  }

  const currentEpisode: TimestoryEpisode =
    episodes.find((e) => e.id === activeEpisodeId) ?? episodes[0]!;

  // Krátky prechod pri prepnutí kapitoly — vizuálna spätná väzba.
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    setSwitching(true);
    const id = setTimeout(() => setSwitching(false), 320);
    return () => clearTimeout(id);
  }, [activeEpisodeId]);

  const filteredAnomalies =
    filterStrength === "all"
      ? anomalies
      : anomalies.filter((a) => a.strength === filterStrength);

  function handleCopyPrompt(episode: TimestoryEpisode) {
    const text = `/* COMIC PANEL PROMPT — EPISODE ${episode.id} (${episode.chapterLetter}) */
PROMPT:
${episode.comicPrompt}

NEGATIVE PROMPT:
${episode.negativePrompt}

CAMERA & COMPOSITION:
${episode.cameraAngle}

DIALOGUE / TEXT OVERLAY:
NARRATOR: "${episode.narratorBox}"
SFX: ${episode.soundEffect}
${episode.dialogues.map((d) => `${d.speaker.toUpperCase()}: "${d.text}"`).join("\n")}`;

    void navigator.clipboard.writeText(text).then(
      () => {
        setCopiedPromptId(episode.id);
        toast.success(
          `AI Comic Prompt pre Epizódu ${episode.id} (${episode.chapterLetter}) skopírovaný!`,
        );
        setTimeout(() => setCopiedPromptId(null), 2500);
      },
      () => {
        toast.error("Kopírovanie do schránky zlyhalo. Skúste to znova.");
      },
    );
  }

  function handleCopyAllPrompts() {
    const allText = `/* ==========================================================
   KOMPLETNÝ KOMIKSOVÝ STORYBOARD & PROMPTY OD A PO Z
   KAUZA: PPZ-51/UBOK-PZ-ST-2025 // SKUTOČNÁ PRAVDA
   ========================================================== */

MASTER STYLE ANCHOR:
${MASTER_COMIC_STYLE_ANCHOR}

--------------------------------------------------------------
${episodes.map(
  (ep) => `EPIZÓDA ${ep.id} // KAPITOLA ${ep.chapterLetter}: ${ep.title}
DÁTUM & MIESTO: ${ep.date} | ${ep.location}
SFX ONOMATOPOEIA: ${ep.soundEffect}
NARRÁTOR: "${ep.narratorBox}"

AI PROMPT:
${ep.comicPrompt}

NEGATIVE PROMPT:
${ep.negativePrompt}

KOMIKSOVÉ DIALÓGY:
${ep.dialogues.map((d) => `  • ${d.speaker} (${d.role}): "${d.text}"`).join("\n")}
--------------------------------------------------------------`,
).join("\n\n")}`;

    void navigator.clipboard.writeText(allText).then(
      () => {
        setCopiedAllPrompts(true);
        toast.success(
          "Kompletný komiksový scenár & prompty (A–Z) skopírované do schránky!",
        );
        setTimeout(() => setCopiedAllPrompts(false), 3000);
      },
      () => {
        toast.error("Kopírovanie do schránky zlyhalo. Skúste to znova.");
      },
    );
  }

  return (
    <div className="space-y-4">
      {/* ═══ HLAVNÝ NOIR COMIC BANNER ═══ */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-primary/50 bg-linear-to-br from-black via-card/95 to-primary/15 p-4 sm:p-5 shadow-2xl">
        {/* Pozadie v štýle komiksového rastra (halftone dots) */}
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "8px 8px",
          }}
        />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/80 pb-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-amber-500 text-black border-none font-black text-[10px] tracking-wider uppercase px-2.5 py-0.5 shadow-md">
                ⭐ 1. Z MOŽNOSTÍ: NAJBLIŽŠIE K PRAVDE
              </Badge>
              <Badge
                variant="outline"
                className="text-[10px] border-primary/60 text-primary font-mono font-bold"
              >
                A–Z TIMESTORY STORYBOARD
              </Badge>
              <Badge className="bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[9px] font-black uppercase">
                FRANK MILLER NOIR STÝL
              </Badge>
              <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-black uppercase animate-pulse">
                {isDemo
                  ? "SYNTETICKÁ UKÁŽKA — FIKTÍVNE ÚDAJE"
                  : "PRACOVNÁ REKONŠTRUKCIA Z AKTÍVNEHO SPISU"}
              </Badge>
            </div>
            <h3 className="text-lg sm:text-2xl font-black text-foreground tracking-tight flex items-center gap-2">
              <span>{caseTitle}: Priebeh od A po Z</span>
            </h3>
            <p className="text-xs text-muted-foreground max-w-3xl leading-relaxed">
              {isDemo
                ? "Syntetická ukážka — vymyslené osoby, firmy a sumy."
                : "Pracovný storyboard zostavený iba z udalostí, zistení a zdrojov aktívneho spisu. Pred použitím v konaní overte každý údaj proti originálu."}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPrintModal(true)}
              className="text-xs h-9 gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 font-bold cursor-pointer"
            >
              <Printer className="h-4 w-4 text-emerald-400" />
              <span>🖨️ Tlačiť pre senát</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPromptModal(!showPromptModal)}
              className="text-xs h-9 gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 font-bold cursor-pointer"
            >
              <Palette className="h-4 w-4 text-amber-400" />
              <span>
                {showPromptModal
                  ? "Skryť AI Prompty"
                  : "🎨 Zobraziť AI Prompty"}
              </span>
            </Button>
            <Button
              size="sm"
              onClick={handleCopyAllPrompts}
              className="text-xs h-9 gap-1.5 font-bold cursor-pointer shadow-md bg-primary hover:bg-primary/90"
            >
              {copiedAllPrompts ? (
                <>
                  <Check className="h-4 w-4 text-emerald-300" />
                  <span>Skopírované!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  <span>Skopírovať scenár (A–Z)</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* 3 HLAVNÉ PILIERE PRAVDY */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-3.5 relative z-10">
          {episodes.slice(0, 3).map((episode, index) => (
            <div
              key={episode.id}
              className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-1"
            >
              <div className="flex items-center gap-1.5 text-primary font-bold text-xs">
                {index === 0 ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <FileSearch className="h-3.5 w-3.5 shrink-0" />}
                {index + 1}. {episode.title}
              </div>
              <p className="text-[11px] text-foreground/80 leading-snug">
                {episode.forensicAnalysis}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ KOPÍROVATEĽNÝ BOX S AI PROMPTAMI (AK JE ROZBALENÝ) ═══ */}
      {showPromptModal && (
        <Card className="p-4 sm:p-5 border-amber-500/40 bg-linear-to-br from-card via-amber-950/10 to-card space-y-3.5 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-border/70 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-amber-500/20 p-1.5 text-amber-400">
                <Palette className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-xs font-black text-foreground uppercase tracking-wide">
                  Master AI Prompty pre generovanie komiksu (Midjourney / Imagen
                  / DALL-E)
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  Skopíruj priamo do AI obrazového modelu a vytvor brutálne
                  grafické noir panely
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowPromptModal(false)}
              className="text-xs h-7 text-muted-foreground hover:text-foreground"
            >
              Zavrieť
            </Button>
          </div>

          <div className="rounded-lg bg-black/70 border border-amber-500/30 p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono text-amber-300 font-bold">
              <span>
                MASTER STYLE ANCHOR (Použiť na začiatku každého promptu):
              </span>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(MASTER_COMIC_STYLE_ANCHOR);
                  toast.success("Master Style Anchor skopírovaný!");
                }}
                className="text-[10px] text-amber-400 hover:text-amber-200 underline cursor-pointer flex items-center gap-1"
              >
                <Copy className="h-3 w-3" /> Skopírovať štýl
              </button>
            </div>
            <p className="text-xs font-mono text-white/90 leading-relaxed bg-black/50 p-2.5 rounded border border-white/10">
              {MASTER_COMIC_STYLE_ANCHOR}
            </p>
          </div>

          {/* Rýchly zoznam všetkých promptov s kopírovaním */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
            {episodes.map((ep) => (
              <div
                key={ep.id}
                className="rounded-lg border border-border/80 bg-muted/20 p-2.5 space-y-1.5 flex flex-col justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-primary/20 text-primary border-primary/30 text-[9px] font-mono font-bold">
                      {ep.chapterLetter} // EP {ep.id}
                    </Badge>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {ep.date}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-foreground line-clamp-1">
                    {ep.title}
                  </p>
                  <p className="text-[10px] font-mono text-amber-400/90 italic">
                    SFX: {ep.soundEffect}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopyPrompt(ep)}
                  className="w-full h-7 text-[11px] gap-1 cursor-pointer font-semibold border-amber-500/30 text-amber-300 hover:bg-amber-500/10 mt-2"
                >
                  {copiedPromptId === ep.id ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span>Skopírované!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Kopírovať prompt</span>
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ═══ SEKCIA 1: KOMIKSOVÁ ČASOVÁ OS (A PO Z TIMESTORY) ═══ */}
      <Card className="space-y-4 p-4 sm:p-5 border-border/80 bg-card/95 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Chronologická Timestory (2024 –
              2026)
            </span>
            <h4 className="text-sm sm:text-base font-black text-foreground">
              Brutálny komiksový storyboard: Kapitoly A až F
            </h4>
          </div>

          {/* Navigačná lišta kapitol A-F */}
          <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/70">
            {episodes.map((ep) => (
              <button
                key={ep.id}
                onClick={() => setActiveEpisodeId(ep.id)}
                className={`flex h-8 px-2.5 items-center justify-center gap-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                  activeEpisodeId === ep.id
                    ? "bg-primary text-primary-foreground shadow-md scale-105"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
                title={ep.title}
              >
                <span>{ep.chapterLetter}</span>
                <span className="hidden md:inline font-mono text-[10px] opacity-80">
                  (Ep {ep.id})
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ═══ AKTÍVNA EPIZÓDA S KOMIKSOVÝM PANELOM ═══ */}
        <div
          key={activeEpisodeId}
          className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start animate-fade-in"
        >
          {/* ĽAVÁ ČASŤ: VIZUÁL KOMIKSOVÉHO PANELU */}
          <div className="lg:col-span-7 space-y-2.5">
            <div className="relative overflow-hidden rounded-2xl border-2 border-black/80 bg-black shadow-2xl group transition-transform duration-300 hover:scale-[1.01]">
              {switching ? (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-[2px]">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                </div>
              ) : null}

              {/* Halftone komiksový vzor v ráme */}
              <div
                className="absolute inset-0 opacity-15 pointer-events-none z-10"
                style={{
                  backgroundImage:
                    "radial-gradient(circle, #fff 1px, transparent 1px)",
                  backgroundSize: "6px 6px",
                }}
              />

              {currentEpisode.comicImage && !brokenImages[currentEpisode.id] ? (
                /* Zobrazenie skutočne vygenerovaného komiksového obrazu */
                <div className="relative aspect-video w-full overflow-hidden bg-black">
                  <img
                    src={currentEpisode.comicImage}
                    alt={currentEpisode.title}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                    onError={() =>
                      setBrokenImages((prev) => ({
                        ...prev,
                        [currentEpisode.id]: true,
                      }))
                    }
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-black via-black/30 to-transparent pointer-events-none" />

                  {/* Žltý noir komiksový narrátor box (hore) */}
                  <div className="absolute top-3 left-3 right-3 z-20">
                    <div className="bg-yellow-400 text-black px-3 py-1.5 rounded-sm font-black text-[10px] uppercase tracking-wider shadow-lg border-2 border-black rotate-[-0.5deg]">
                      {currentEpisode.narratorBox}
                    </div>
                  </div>

                  {/* Zvukový efekt Onomatopoeia (plávajúci komiksový nápis) */}
                  <div className="absolute bottom-16 right-4 z-20 pointer-events-none">
                    <span className="font-black italic text-lg sm:text-2xl text-amber-400 drop-shadow-[0_2px_4px_rgba(0,0,0,1)] tracking-widest rotate-[-4deg] animate-pulse">
                      {currentEpisode.soundEffect}
                    </span>
                  </div>

                  {/* Spodný popis panelu */}
                  <div className="absolute bottom-3 left-3 right-3 z-20 flex items-center justify-between text-[11px] text-white/95 font-medium bg-black/85 p-2 rounded-lg backdrop-blur-xs border border-white/20">
                    <span className="italic truncate pr-2">
                      "{currentEpisode.caption}"
                    </span>
                    <Badge className="bg-primary/80 text-primary-foreground shrink-0 text-[9px] font-mono">
                      PANEL {currentEpisode.chapterLetter}
                    </Badge>
                  </div>
                </div>
              ) : (
                /* Brutálny grafický komiksový panel (fallback s dynamickým nočným SVG & efektmi) */
                <div className="relative aspect-video w-full flex flex-col justify-between p-4 bg-linear-to-br from-slate-950 via-zinc-950 to-neutral-900 border-2 border-primary/40 overflow-hidden">
                  {/* Efekt nočného dažďa a tieňov */}
                  <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_45%,rgba(255,255,255,0.05)_50%,transparent_55%)] pointer-events-none" />

                  {/* Žltý noir komiksový narrátor box */}
                  <div className="relative z-20">
                    <div className="bg-yellow-400 text-black px-3 py-1.5 rounded-sm font-black text-[10px] uppercase tracking-wider shadow-lg border-2 border-black rotate-[-0.5deg] max-w-lg">
                      {currentEpisode.narratorBox}
                    </div>
                  </div>

                  {/* Grafická scéna v strede (Siluety a dramatická kompozícia) */}
                  <div className="relative z-20 my-auto text-center space-y-2 py-4">
                    <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400 border-2 border-amber-500/40 shadow-lg mx-auto -rotate-2">
                      {currentEpisode.id === 4 ? (
                        <Flame className="h-7 w-7 text-rose-500 animate-bounce" />
                      ) : currentEpisode.id === 5 ? (
                        <Car className="h-7 w-7 text-cyan-400" />
                      ) : (
                        <Scale className="h-7 w-7 text-amber-400" />
                      )}
                    </div>

                    <h5 className="font-black text-base sm:text-lg text-white uppercase tracking-wider">
                      {currentEpisode.title}
                    </h5>

                    {/* Veľké onomatopoeia */}
                    <div className="pt-1">
                      <span className="inline-block font-black italic text-xl sm:text-3xl text-amber-400 drop-shadow-[0_2px_4px_rgba(0,0,0,1)] tracking-widest -rotate-3">
                        {currentEpisode.soundEffect}
                      </span>
                    </div>

                    <p className="text-xs text-white/80 max-w-md mx-auto italic px-2">
                      "{currentEpisode.caption}"
                    </p>
                  </div>

                  {/* Spodná lišta grafického panelu */}
                  <div className="relative z-20 flex items-center justify-between text-[10px] text-muted-foreground border-t border-white/10 pt-2 bg-black/60 -mx-4 -mb-4 px-4 py-2">
                    <span className="flex items-center gap-1.5 text-white/80 font-mono">
                      <MapPin className="h-3 w-3 text-primary" />
                      {currentEpisode.location}
                    </span>
                    <span className="font-mono text-amber-400 font-black tracking-wider">
                      KAPITOLA {currentEpisode.chapterLetter} // EP{" "}
                      {currentEpisode.id}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* KOMIKSOVÉ BUBLINY / REČOVÉ BALÓNY V SCÉNE */}
            <div className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-primary" /> Rečové
                  bubliny & dialógy scény:
                </span>
                <span className="text-[10px] font-mono text-primary font-bold">
                  {currentEpisode.dialogues.length} repliky
                </span>
              </div>

              <div className="space-y-2 pt-1">
                {currentEpisode.dialogues.map((dlg, dIdx) => {
                  const isBabcan = dlg.role === "Novák";
                  return (
                    <div
                      key={dIdx}
                      className={`flex flex-col text-xs ${
                        isBabcan ? "items-start" : "items-end"
                      }`}
                    >
                      <span className="text-[10px] font-bold text-muted-foreground px-1 mb-0.5">
                        {dlg.speaker}
                      </span>
                      <div
                        className={`max-w-[88%] rounded-xl px-3 py-2 text-xs shadow-sm border ${
                          isBabcan
                            ? "bg-primary/15 border-primary/30 text-foreground font-medium rounded-tl-xs"
                            : "bg-amber-500/15 border-amber-500/30 text-amber-200 font-medium rounded-tr-xs"
                        }`}
                      >
                        "{dlg.text}"
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AKČNÁ LIŠTA POD PANELOM: PREKLIK, PREHRÁVAČ & KOPÍROVANIE PROMPTU */}
            <div className="space-y-2 pt-1">
              {/* Slideshow Progress Bar ak hrá */}
              {isPlaying && (
                <div className="w-full bg-muted/60 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-amber-400 h-full transition-all duration-100 ease-linear rounded-full"
                    style={{ width: `${playProgress}%` }}
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-8 gap-1 cursor-pointer font-bold"
                    disabled={activeEpisodeId <= 1}
                    onClick={() => {
                      setIsPlaying(false);
                      setActiveEpisodeId((prev) => Math.max(1, prev - 1));
                    }}
                  >
                    ← Kapitola{" "}
                    {
                      episodes[Math.max(0, activeEpisodeId - 2)]
                        ?.chapterLetter
                    }
                  </Button>

                  <Button
                    size="sm"
                    variant={isPlaying ? "default" : "outline"}
                    onClick={togglePlaySlideshow}
                    className={`text-xs h-8 gap-1.5 font-bold cursor-pointer transition-all ${
                      isPlaying
                        ? "bg-amber-500 hover:bg-amber-400 text-black border-none shadow-md"
                        : "border-primary/40 text-primary hover:bg-primary/10"
                    }`}
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="h-3.5 w-3.5" />
                        <span>Pozastaviť film</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                        <span>Prehrať filmový pás</span>
                      </>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-8 gap-1 cursor-pointer font-bold"
                    disabled={activeEpisodeId >= episodes.length}
                    onClick={() => {
                      setIsPlaying(false);
                      setActiveEpisodeId((prev) =>
                        Math.min(episodes.length, prev + 1),
                      );
                    }}
                  >
                    Kapitola{" "}
                    {
                      episodes[
                        Math.min(episodes.length - 1, activeEpisodeId)
                      ]?.chapterLetter
                    }{" "}
                    →
                  </Button>
                </div>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleCopyPrompt(currentEpisode)}
                  className="text-xs h-8 gap-1.5 border border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 font-bold cursor-pointer"
                >
                  {copiedPromptId === currentEpisode.id ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Prompt skopírovaný!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 text-amber-400" />
                      <span>Kopírovať Prompt pre Midjourney</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* PRAVÁ ČASŤ: FORENZNÁ REALITA & DEMASKOVANIE KLAMSTIEV */}
          <div className="lg:col-span-5 space-y-3">
            <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-md">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <span className="text-[10px] font-mono font-bold text-primary uppercase">
                  {currentEpisode.date} · {currentEpisode.location}
                </span>
                <Badge variant="secondary" className="text-[10px] font-bold">
                  Skutková realita
                </Badge>
              </div>

              <h4 className="text-base sm:text-lg font-black text-foreground">
                {currentEpisode.title}
              </h4>

              {/* Forenzná analýza reality */}
              <div className="rounded-lg bg-muted/40 border border-border/60 p-3 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <FileSearch className="h-3.5 w-3.5 text-primary" /> Skutočný
                  priebeh udalosti (Fakty zo spisu):
                </span>
                <p className="text-xs text-foreground/90 leading-relaxed">
                  {currentEpisode.forensicAnalysis}
                </p>
              </div>

              {/* Vyvrátené klamstvo obžaloby */}
              <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />{" "}
                  Vyvrátené skreslenie / klamstvo OČTK:
                </span>
                <p className="text-xs text-foreground/95 leading-relaxed font-semibold">
                  {currentEpisode.debunkedLie}
                </p>
              </div>

              {/* Prompt Detail Box pre túto scénu */}
              <div className="rounded-lg bg-black/50 border border-amber-500/30 p-2.5 space-y-1 font-mono text-[11px]">
                <div className="flex items-center justify-between text-amber-400 font-bold text-[10px]">
                  <span>Vizuálny popis kamery & scény:</span>
                  <span className="text-muted-foreground">
                    {currentEpisode.cameraAngle}
                  </span>
                </div>
                <p className="text-[10px] text-white/70 line-clamp-2">
                  {currentEpisode.comicPrompt}
                </p>
              </div>

              {/* Aktéri scény */}
              <div className="space-y-1 pt-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Users className="h-3 w-3 text-primary/70" /> Reálni aktéri v
                  scéne:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {currentEpisode.involvedActors.map((actor, aIdx) => (
                    <Badge
                      key={aIdx}
                      variant="outline"
                      className="text-[10px] bg-muted/60 border-border/80 text-foreground font-medium"
                    >
                      {actor}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ═══ SEKCIA 2: SÚHRNNÁ MATICA 6 ANOMÁLIÍ (DEKONŠTRUKCIA OBŽALOBY) ═══ */}
      <Card className="space-y-3.5 p-4 sm:p-5 border-border/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/40 text-[10px] font-bold uppercase">
                6 KĽÚČOVÝCH ANOMÁLIÍ
              </Badge>
              <span className="text-xs text-muted-foreground font-semibold">
                Dekonštrukcia tvrdení OČTK & Procesné návrhy
              </span>
            </div>
            <h4 className="text-sm sm:text-base font-black text-foreground">
              Prehľad sporných bodov a ich okamžité logické vysvetlenie
            </h4>
          </div>

          {/* Filter sily */}
          <div className="flex items-center gap-1">
            {[
              "all",
              "Nepriestrelné",
              "Rozhodujúci rozpor",
              "Kritické pre OČTK",
            ].map((f) => (
              <button
                key={f}
                onClick={() => setFilterStrength(f)}
                className={`text-[10px] px-2 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                  filterStrength === f
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {f === "all" ? `Všetky (${anomalies.length})` : f}
              </button>
            ))}
          </div>
        </div>

        {/* ZOZNAM KARIET ANOMÁLIÍ */}
        <div className="space-y-2.5">
          {filteredAnomalies.map((anomaly) => {
            const isExpanded = expandedAnomalyId === anomaly.id;
            return (
              <div
                key={anomaly.id}
                className="rounded-xl border border-border/80 bg-card overflow-hidden transition-all shadow-xs"
              >
                {/* Hlavička anomálie */}
                <button
                  type="button"
                  onClick={() =>
                    setExpandedAnomalyId(isExpanded ? null : anomaly.id)
                  }
                  className="w-full text-left p-3 flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary font-black text-xs">
                      {anomaly.id}
                    </span>
                    <div className="min-w-0">
                      <h5 className="font-bold text-xs sm:text-sm text-foreground truncate">
                        {anomaly.title}
                      </h5>
                      <p className="text-[11px] text-muted-foreground truncate">
                        Zdroj: {anomaly.sourceOfClaim}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant="outline"
                      className={`text-[9px] font-bold ${
                        anomaly.strength === "Nepriestrelné"
                          ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                          : anomaly.strength === "Rozhodujúci rozpor"
                            ? "border-rose-500/40 text-rose-400 bg-rose-500/10"
                            : "border-amber-500/40 text-amber-400 bg-amber-500/10"
                      }`}
                    >
                      {anomaly.strength}
                    </Badge>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {/* Rozbalené detaily */}
                {isExpanded && (
                  <div className="p-3 pt-0 border-t border-border/60 bg-muted/10 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-3">
                      {/* Tvrdenie obžaloby */}
                      <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-2.5 space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Tvrdenie OČTK
                          proti Novákovi:
                        </span>
                        <p className="text-xs text-foreground/90 font-medium">
                          {anomaly.prosecutionClaim}
                        </p>
                      </div>

                      {/* Forenzné rozbitie v prospech obhajoby */}
                      <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2.5 space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" /> Forenzné
                          vysvetlenie (Dôkazné rozbitie):
                        </span>
                        <p className="text-xs text-foreground/95 font-medium">
                          {anomaly.forensicTruth}
                        </p>
                      </div>
                    </div>

                    {/* Dôkazy a procesný návrh */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-2.5 rounded-lg border border-border">
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-primary" />{" "}
                          Kľúčové fakty potvrdzujúce obhajobu:
                        </span>
                        <ul className="space-y-0.5 text-[11px] text-foreground/85">
                          {anomaly.keyEvidence.map((ev, eIdx) => (
                            <li
                              key={eIdx}
                              className="flex items-center gap-1.5 truncate"
                            >
                              <span className="text-primary font-bold">•</span>
                              <span>{ev}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="shrink-0 space-y-2 sm:text-right border-t sm:border-t-0 sm:border-l border-border pt-2 sm:pt-0 sm:pl-3">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block">
                            Procesný návrh:
                          </span>
                          <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px] font-mono">
                            {anomaly.proceduralParagraph}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setExpandedMotionId((curr) =>
                                curr === anomaly.id ? null : anomaly.id,
                              )
                            }
                            className="h-7 text-[11px] gap-1 cursor-pointer font-semibold border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                          >
                            <FileText className="h-3 w-3 text-amber-400" />
                            <span>
                              {expandedMotionId === anomaly.id
                                ? "Skryť návrh"
                                : "Náhľad návrhu"}
                            </span>
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleCopyMotion(anomaly)}
                            className="h-7 text-[11px] gap-1 cursor-pointer font-bold bg-primary hover:bg-primary/90 text-primary-foreground"
                          >
                            {copiedMotionId === anomaly.id ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-300" />
                                <span>Skopírované!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                <span>Kopírovať pre súd</span>
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* ROZBALENÝ TEXT PROCESNÉHO NÁVRHU PRE SÚD / OČTK */}
                    {expandedMotionId === anomaly.id && (
                      <div className="rounded-lg bg-black/80 border border-amber-500/40 p-3 space-y-2 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                          <span className="text-[10px] font-mono font-bold text-amber-300 flex items-center gap-1.5">
                            <Scale className="h-3.5 w-3.5 text-amber-400" />{" "}
                            Oficiálny procesný návrh pre OČTK / Súd (
                            {anomaly.proceduralParagraph}):
                          </span>
                          <button
                            onClick={() => handleCopyMotion(anomaly)}
                            className="text-[10px] text-amber-400 hover:text-amber-200 underline cursor-pointer flex items-center gap-1 font-mono"
                          >
                            <Copy className="h-3 w-3" /> Skopírovať text podania
                          </button>
                        </div>
                        <pre className="text-[11px] font-mono text-white/90 whitespace-pre-wrap leading-relaxed bg-black/50 p-2.5 rounded border border-white/10 select-all">
                          {anomaly.motionText}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* ═══ SEKCIA 3: GEOGRAFICKÁ MAPA TRÁS & FORENZNÉ POROVNANIE POHYBU ═══ */}
      {!isDemo ? (
        <Card className="space-y-3 p-4 sm:p-5 border-border/80 bg-card/95 shadow-xl">
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 text-cyan-400" />
            <h4 className="text-sm font-black">Trasy a miesta v aktívnom spise</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            Tento spis neobsahuje predpripravenú mapu. Miesta a trasy uvádzané
            v časovej osi sú zobrazené výlučne podľa zdrojov jednotlivých udalostí.
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
              Geografické rozdelenie rolí: Kde bol reálne Novák vs kde mizli
              zbrane
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
              Pohyb obvineného bol striktne ohraničený jeho bydliskom a jediným
              stretnutím v Banskej Bystrici. Vyšetrovací spis neobsahuje jediný
              dôkaz o jeho prítomnosti na diaľnici D1 ani v sklade v Žiline.
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
                    Tvorba webstránok, občasné vklady hotovosti dodanej Ľubošom
                    v Dunajskej banke, vypnutie telefónu na jar 2025.
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
                    Odovzdanie originálu zbrojnej licencie LA 002318 a
                    evidenčných kníh osobe „Ľubo“. Od tohto dňa doklady fyzicky
                    nemal.
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
                    Nulová fyzická prítomnosť pri nákupoch. Žiadne BTS dáta
                    nepotvrdzujú jeho prítomnosť v predajni ARMIVEX.
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
                    Nulový záznam o jazde, 0 mýtnych transakcií, 0 zahraničných
                    hovorov, nulový medzinárodný roaming.
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
              Skutočné nákupy, manipuláciu s tovarom a distribúciu vykonával
              Denis Koval s Miroslavom Tkáčom cez vozidlá BMW 7 a prekládky na
              nočných diaľničných odpočívadlách.
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
                    Naverbovanie IT vývojára Nováka pod zámienkou programovania
                    legálneho zbraňového e-shopu.
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
                    Odber zbraní vykonával Koval osobne s Dmitrijom Malinaom a
                    Norbertom Slezákom (Bark Factory Enterprise).
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
                    Nočné prekládky desiatok kusov zbraní z kufra BMW 7 o 02:00
                    neznámym odberateľom bez sprievodnej dokumentácie.
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
                    Záchyt 242 zbraní Guardia Civil v kriminálnom prostredí.
                    Trasovanie potvrdzuje zahraničných kuriérov mimo Nováka.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Súhrnná porovnávacia tabuľka telemetrických dát */}
        <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Scale className="h-3.5 w-3.5 text-primary" /> Telemetrické a
            procesné porovnanie (Dôkaz neviny):
          </span>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/60 text-[10px] font-mono uppercase text-muted-foreground">
                  <th className="py-1.5 px-2">Forenzné Kritérium</th>
                  <th className="py-1.5 px-2 text-emerald-400">Peter Novák</th>
                  <th className="py-1.5 px-2 text-rose-400">
                    Denis Koval & Sieť
                  </th>
                  <th className="py-1.5 px-2 text-amber-300">
                    Procesný dôsledok pre súd
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 text-[11px]">
                <tr>
                  <td className="py-1.5 px-2 font-semibold">
                    Pohyb na diaľnici D1
                  </td>
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
                  <td className="py-1.5 px-2 font-semibold">
                    Lokalizácia mobilu (BTS)
                  </td>
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
                  <td className="py-1.5 px-2 font-semibold">
                    Zahraničný roaming & hovory
                  </td>
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
                  <td className="py-1.5 px-2 font-semibold">
                    Vozidlá a preprava
                  </td>
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

      {/* ═══ MODÁL PRE TLAČ STORYBOARDU PRE SENÁT ═══ */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-5xl bg-card border-2 border-border/80 rounded-2xl shadow-2xl p-5 sm:p-7 space-y-5 my-8">
            {/* Horná lišta modálu */}
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-emerald-500/20 p-2 text-emerald-400">
                  <Printer className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-foreground uppercase tracking-wide">
                    Tlačová zostava: Vizuálna dôkazná príloha pre súd
                  </h3>
                  <p className="text-xs text-muted-foreground font-mono">
                    {dossier?.caseId ?? activeCase.id} // Zrekonštruovaný dej od A po Z
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => window.print()}
                  className="gap-1.5 bg-primary hover:bg-primary/90 text-xs font-bold cursor-pointer shadow-md"
                >
                  <Printer className="h-4 w-4" />
                  <span>Vytlačiť / Uložiť do PDF</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowPrintModal(false)}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Samotný tlačový obsah */}
            <div className="space-y-6 text-foreground">
              {/* Formálna hlavička podania */}
              <div className="border-b-2 border-foreground/20 pb-4 text-center space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">
                  {isDemo
                    ? "SYNTETICKÁ UKÁŽKA — FIKTÍVNE ÚDAJE • DEMONŠTRATÍVNY STORYBOARD"
                    : "PRACOVNÝ STORYBOARD Z AKTÍVNEHO SPISU • VYŽADUJE OVERENIE ZDROJOV"}
                </span>
                <h2 className="text-xl font-black uppercase tracking-tight">
                  {caseTitle}: Priebeh od A po Z
                </h2>
                <p className="text-xs text-muted-foreground max-w-2xl mx-auto">
                  Pracovná rekonštrukcia založená na udalostiach a zisteniach
                  aktuálneho dosiéru; nejde o samostatný dôkaz ani znalecký posudok.
                </p>
              </div>

              {/* Všetkých 6 kapitol v tlačovom zobrazení */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {episodes.map((ep) => (
                  <div
                    key={ep.id}
                    className="border-2 border-border/80 rounded-xl p-3.5 space-y-2.5 bg-muted/10 break-inside-avoid"
                  >
                    <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
                      <Badge className="bg-primary/20 text-primary border-primary/40 font-mono font-bold text-[10px]">
                        KAPITOLA {ep.chapterLetter} // EP {ep.id}
                      </Badge>
                      <span className="text-[10px] font-mono text-muted-foreground font-bold">
                        {ep.date} · {ep.location}
                      </span>
                    </div>

                    <h4 className="font-black text-sm text-foreground">
                      {ep.title}
                    </h4>

                    {/* Vizuál kapitoly */}
                    <div className="relative aspect-video rounded-lg overflow-hidden border border-border bg-black">
                      {ep.comicImage && !brokenImages[ep.id] ? (
                        <img
                          src={ep.comicImage}
                          alt={ep.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="h-full w-full flex flex-col items-center justify-center p-3 text-center bg-zinc-950 text-white space-y-1">
                          <span className="text-amber-400 font-mono font-black text-xs">
                            {ep.soundEffect}
                          </span>
                          <span className="text-[10px] text-muted-foreground italic line-clamp-2">
                            "{ep.caption}"
                          </span>
                        </div>
                      )}
                      <div className="absolute top-1.5 left-1.5 right-1.5 bg-yellow-400 text-black px-2 py-0.5 rounded-xs font-black text-[8px] uppercase tracking-wider">
                        {ep.narratorBox}
                      </div>
                    </div>

                    {/* Dialógy */}
                    <div className="space-y-1 bg-black/40 p-2 rounded border border-border/50 text-[10px]">
                      {ep.dialogues.map((dlg, dIdx) => (
                        <p key={dIdx} className="leading-tight">
                          <strong className="text-amber-400">
                            {dlg.speaker}:
                          </strong>{" "}
                          <span className="text-white/90">"{dlg.text}"</span>
                        </p>
                      ))}
                    </div>

                    {/* Forenzný fakt */}
                    <div className="rounded bg-emerald-500/10 border border-emerald-500/30 p-2 text-[10px] text-foreground space-y-0.5">
                      <strong className="text-emerald-400 block font-bold">
                        Skutočnosť zo spisu:
                      </strong>
                      <p className="leading-snug">{ep.forensicAnalysis}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Doložka integrity */}
              <div className="border-t border-border/80 pt-3 flex flex-col sm:flex-row items-center justify-between text-[10px] font-mono text-muted-foreground gap-2">
                <span>
                  Doložka pravdivosti a dôkaznej nemennosti podľa § 119 TP
                </span>
                <span>Identifikátor spisu: {dossier?.caseId ?? activeCase.id}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
