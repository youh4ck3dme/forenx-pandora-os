import {
  Activity,
  Bot,
  Crosshair,
  FolderKanban,
  Inbox,
  LayoutGrid,
  LineChart,
  MoreHorizontal,
  Network,
  FileUp,
  Plug,
  Scale,
  Palette,
  CreditCard,
  ShieldCheck,
  Share2,
  Sparkles,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon };
export type NavGroup = { title: string; items: NavItem[] };

/** Spodná navigácia na mobile — denný tok (Spisy → Autopilot → Sandbox → Sieť → Viac). */
export const navItems: NavItem[] = [
  { to: "/forza/pripady", label: "Spisy", icon: FolderKanban },
  { to: "/forza/asistent", label: "Autopilot", icon: Bot },
  { to: "/forza/sandbox", label: "Sandbox", icon: Inbox },
  { to: "/forza/siet", label: "Sieť", icon: Network },
  { to: "/forza/viac", label: "Viac", icon: MoreHorizontal },
];

/** Jediná konfigurácia skupín pre bočné menu aj obrazovku „Viac“. */
export const navGroups: NavGroup[] = [
  {
    title: "Prípad",
    items: [
      { to: "/forza/prehlad", label: "Prehľad", icon: LayoutGrid },
      { to: "/forza/pripady", label: "Prípady", icon: FolderKanban },
      { to: "/forza/asistent", label: "Forenzný Autopilot", icon: Bot },
      { to: "/forza/sandbox", label: "AI Sandbox", icon: Sparkles },
      { to: "/forza/import-csv", label: "Import CSV", icon: FileUp },
    ],
  },
  {
    title: "Zistenia",
    items: [
      { to: "/forza/analyza-vypisov", label: "Analýza", icon: LineChart },
      { to: "/forza/osoby", label: "Osoby", icon: Users },
      { to: "/forza/vztahy", label: "Vzťahy", icon: Network },
      { to: "/forza/siet", label: "Sieť tokov", icon: Share2 },
      { to: "/forza/zbrane", label: "Zbrane", icon: Crosshair },
      { to: "/forza/pravny-kontext", label: "Právny kontext", icon: Scale },
    ],
  },
  {
    title: "Účet",
    items: [
      { to: "/forza/profil", label: "Môj profil", icon: UserCog },
      { to: "/forza/vzhlad", label: "Vzhľad a téma", icon: Palette },

      { to: "/forza/predplatne", label: "Predplatné", icon: CreditCard },
      { to: "/forza/sukromie", label: "Súkromie", icon: ShieldCheck },
      { to: "/forza/mcp-info", label: "Agentné API", icon: Plug },
      { to: "/forza/stav", label: "Stav systému", icon: Activity },
    ],
  },
];

/** Plochý zoznam pre staršie použitia. */
export const secondaryItems: NavItem[] = navGroups.flatMap(
  (group) => group.items,
);
