import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function px(value: number | string): string {
  if (typeof value === "number") {
    return `${value}px`;
  }
  return value.endsWith("px") ? value : `${value}px`;
}

export const logger = {
  info: (msg: string, ...args: unknown[]) => console.info(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg: string, ...args: unknown[]) => console.debug(`[DEBUG] ${msg}`, ...args),
};

export function getGPUInfo(): { particleSize: number; tier: number; description: string } {
  if (typeof window === "undefined") {
    return { particleSize: 256, tier: 2, description: "SSR" };
  }
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) {
      return { particleSize: 256, tier: 1, description: "No WebGL" };
    }
    const ext = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
    const renderer = ext ? (gl as WebGLRenderingContext).getParameter(ext.UNMASKED_RENDERER_WEBGL) : "";
    return { particleSize: 512, tier: 2, description: String(renderer || "WebGL") };
  } catch {
    return { particleSize: 256, tier: 2, description: "Fallback" };
  }
}

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  content: string;
  publishedAt: string;
  readingTime: number;
  tags: string[];
  coverImage?: string;
  author: {
    name: string;
  };
}

export const blogPosts: BlogPost[] = [
  {
    slug: "bezpecnost-prehliadacov-a-izolacia",
    title: "Moderná bezpečnosť webových prehliadačov: Izolácia procesov a ochrana pamäte",
    description: "Ako PΛND0RΛ Browser pristupuje k izolácii nebezpečného kódu a ochrane dát používateľa.",
    content: `# Moderná bezpečnosť prehliadačov\n\nBezpečnosť pri prehliadaní webu sa stala kľúčovým prvkom ochrany identity a súkromia.\n\n## Architektúra nulovej dôvery\nPΛND0RΛ Browser využíva striktné oddelenie tabov a bezpečnostné sandboxy.\n\n- Úplná izolácia každej záložky v samostatnom procese\n- Hardvérovo akcelerovaná ochrana pamäte\n- Blokovanie neautorizovaných skriptov a telemetrie`,
    publishedAt: "2026-03-15",
    readingTime: 4,
    tags: ["Bezpečnosť", "Architektúra", "PΛND0RΛ"],
    author: { name: "PΛND0RΛ Security Team" },
  },
  {
    slug: "sukromie-a-ochrana-proti-fingerprintingu",
    title: "Prečo bežné inkognito nestačí: Pokročilá obrana proti fingerprintingu",
    description: "Prehľad moderných sledovacích techník založených na Canvas a WebGL a ako sa pred nimi brániť.",
    content: `# Ochrana proti fingerprintingu\n\nTradičné anonymné okná nezabraňujú webom v identifikácii vášho zariadenia podľa hardvérových vlastností.\n\n## Canvas a WebGL randomizácia\nPΛND0RΛ randomizuje citlivé vykresľovacie metriky, čím zabraňuje vytvoreniu unikátneho digitálneho odtlačku.\n\n- Šumenie hodnôt WebGL\n- Falošné parametre obrazovky a fontov\n- Integrovaný blokovač sledovacích domén`,
    publishedAt: "2026-03-20",
    readingTime: 5,
    tags: ["Súkromie", "Fingerprinting", "Web"],
    author: { name: "PΛND0RΛ Research" },
  },
  {
    slug: "forenzna-analyza-financnych-tokov",
    title: "Forenzná inteligencia: Odhalenie skrytých väzieb a tokov",
    description: "Prepojenie moderného prehliadača a forenzného modulu Forza pre hĺbkovú analýzu prípadov.",
    content: `# Forenzná inteligencia v prehliadači\n\nIntegrácia analytického modulu Forza priamo do prostredia PΛND0RΛ prináša novú úroveň bezpečného vyšetrovania.\n\n## Kľúčové schopnosti\n- Analýza bankových výpisov a štruktúrovaných dát\n- Mapovanie entít a prepojení v grafe\n- Overovanie integrity dôkazov a časovej osi`,
    publishedAt: "2026-03-25",
    readingTime: 6,
    tags: ["Forensics", "Forza", "Financie"],
    author: { name: "Forza Core Team" },
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}

export function getAllBlogSlugs(): string[] {
  return blogPosts.map((p) => p.slug);
}

export function generateBlogMetadata(post: BlogPost) {
  return {
    title: `${post.title} | PΛND0RΛ Blog`,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.publishedAt,
    },
  };
}
