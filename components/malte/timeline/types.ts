import type { ForensicDossier, TimelineEvent } from "@/lib/forza/types";
import type { ForensicCase } from "@/lib/forza/forensic";

export interface AnomalyItem {
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

export interface ComicDialogue {
  speaker: string;
  role: "Novák" | "Koval" | "Ľubo" | "OČTK" | "Hruška" | "Vyšetrovateľ";
  text: string;
}

export interface TimestoryEpisode {
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

export const MASTER_COMIC_STYLE_ANCHOR =
  "Graphic novel comic book panel in Frank Miller Sin City noir style. Stark monochrome high-contrast black and white ink drawing, heavy dynamic chiaroscuro shadows, dramatic cross-hatching, accented with vivid splash colors (neon amber, blood crimson, cyan streetlights). Gritty urban Slovak atmosphere, rain-slicked asphalt, cinematic Dutch angles, comic speech balloons and bold yellow narrative caption boxes, 8k resolution graphic novel illustration --ar 16:9 --style raw";

export const TIMESTORY_EPISODES: TimestoryEpisode[] = [
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

export const ANOMALIES_DATA: AnomalyItem[] = [
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

export function formatTimestoryDate(value: string) {
  const parsed = new Date(value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("sk-SK", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

export function actorNames(event: string, forensicCase: ForensicCase) {
  const matches = forensicCase.entities
    .filter((entity) =>
      event.toLocaleLowerCase().includes(entity.name.toLocaleLowerCase()),
    )
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
