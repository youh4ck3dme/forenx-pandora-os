/**
 * ForenX PΛND0RΛ Core Engine — Unified Case Adaptor Layer
 * 
 * Provides a canonical bidirectional bridge between the Headless Core Engine model
 * (ForensicCaseUnified) and the PΛND0RΛ UI/Analytics models (ForensicCase & ForensicDossier).
 */

import type {
  ForensicCase,
  Entity,
  Transaction,
  Weapon,
  Relation,
  CaseEvent,
  Severity,
} from "./forensic/types";
import type { ForensicDossier } from "./types";

export interface UnifiedEntity {
  id: string;
  name: string;
  kind: "person" | "company";
  role?: string;
  ico?: string;
  dic?: string;
  icDph?: string;
  country?: string;
  address?: string;
  isVip?: boolean;
  isSanctioned?: boolean;
  riskScore?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  x?: number;
  y?: number;
}

export interface UnifiedTransaction {
  id: string;
  date: string;
  amount: number;
  currency: string;
  fromId: string;
  toId: string;
  method?: "cash" | "transfer" | string;
  purpose?: string;
  isSuspicious?: boolean;
  flags?: string[];
  referenceNumber?: string;
  payerId?: string;
  originCountry?: string;
  destinationCountry?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface UnifiedWeapon {
  id: string;
  brand?: string;
  model?: string;
  serial?: string;
  caliber?: string;
  holderId?: string;
  supplierId?: string;
  acquiredAt?: string;
  status?: string;
  seizedDate?: string;
  licence?: string;
  metadata?: Record<string, unknown>;
}

export interface UnifiedRelation {
  fromId: string;
  toId: string;
  label?: string;
  type?: "ownership" | "statutory" | "family" | "associate" | "financial" | "unknown";
  confidence?: number;
  source?: string;
}

export interface UnifiedEvent {
  id?: string;
  date: string;
  title: string;
  detail?: string;
  severity?: Severity | "INFO";
  source?: string;
  verified?: boolean;
}

export interface ForensicCaseUnified {
  version: "2.0.0" | string;
  id: string;
  title: string;
  name?: string;
  subtitle?: string;
  description?: string;
  referenceDate: string;
  baseCurrency: string;
  status?: "open" | "active" | "archived" | "closed";
  jurisdiction?: string;
  investigator?: string;
  createdAt?: string;
  updatedAt?: string;

  // Graph and financial data
  entities: UnifiedEntity[];
  transactions: UnifiedTransaction[];
  weapons?: UnifiedWeapon[];
  relations: UnifiedRelation[];
  events: UnifiedEvent[];

  // External & Mock Datasets
  registries?: {
    europolSerials?: string[];
    validLicences?: string[];
    orsrAddresses?: Record<string, string>;
  };

  // Autopilot & Intelligence Dossier
  dossier?: ForensicDossier | null;

  // Metadata / Custom tags
  metadata?: Record<string, unknown>;
}

/**
 * Validates if an object conforms to the minimal ForensicCaseUnified contract.
 */
export function isForensicCaseUnified(val: unknown): val is ForensicCaseUnified {
  if (!val || typeof val !== "object") return false;
  const c = val as Partial<ForensicCaseUnified>;
  return (
    typeof c.id === "string" &&
    (typeof c.title === "string" || typeof c.name === "string") &&
    Array.isArray(c.entities) &&
    Array.isArray(c.transactions)
  );
}

/**
 * Maps a ForensicCaseUnified instance into the canonical ForensicCase representation
 * required by the deterministic forensic rules engine (analyzeCase) and React UI.
 */
export function mapUnifiedToForensicCase(unified: ForensicCaseUnified): ForensicCase {
  const caseName = unified.name || unified.title || "Nepomenovaný prípad";
  const caseSubtitle = unified.subtitle || unified.description || "";
  const refDate = unified.referenceDate || new Date().toISOString().slice(0, 10);
  const baseCurrency = (unified.baseCurrency || "EUR").toUpperCase();

  // Normalize entities with fallback defaults
  const entities: Entity[] = (unified.entities || []).map((ent, idx) => ({
    id: ent.id || `ent-${idx + 1}`,
    name: ent.name || `Subjekt ${idx + 1}`,
    kind: ent.kind === "company" ? "company" : "person",
    role: ent.role || (ent.kind === "company" ? "spoločnosť" : "konateľ"),
    country: ent.country || "SK",
    x: typeof ent.x === "number" ? ent.x : 20 + (idx % 5) * 15,
    y: typeof ent.y === "number" ? ent.y : 30 + Math.floor(idx / 5) * 15,
    ico: ent.ico,
    address: ent.address,
    note: ent.metadata ? JSON.stringify(ent.metadata) : undefined,
  }));

  // Normalize transactions
  const transactions: Transaction[] = (unified.transactions || []).map((tx, idx) => ({
    id: tx.id || `tx-${idx + 1}`,
    date: tx.date || refDate,
    amount: Number(tx.amount) || 0,
    currency: (tx.currency || baseCurrency).toUpperCase(),
    method: tx.method === "cash" ? "cash" : "transfer",
    fromId: tx.fromId,
    toId: tx.toId,
    payerId: tx.payerId || (tx.metadata?.payerId as string | undefined),
    originCountry: tx.originCountry || (tx.metadata?.originCountry as string) || "SK",
    destinationCountry:
      tx.destinationCountry || (tx.metadata?.destinationCountry as string) || "SK",
    description: tx.description || tx.purpose || "Transakcia",
  }));

  // Normalize weapons
  const weapons: Weapon[] = (unified.weapons || []).map((wp, idx) => ({
    id: wp.id || `wp-${idx + 1}`,
    brand: wp.brand || "Neznáma značka",
    model: wp.model || "Neznámy model",
    serial: wp.serial || `SER-${idx + 1}`,
    holderId: wp.holderId || "",
    supplierId: wp.supplierId || (wp.metadata?.supplierId as string) || wp.holderId || "",
    acquiredAt: wp.acquiredAt || wp.seizedDate || refDate,
    licence: wp.licence || (wp.metadata?.licence as string | undefined),
  }));

  // Normalize relations
  const relations: Relation[] = (unified.relations || []).map((rel) => ({
    fromId: rel.fromId,
    toId: rel.toId,
    label: rel.label || "prepojenie",
  }));

  // Normalize events
  const events: CaseEvent[] = (unified.events || []).map((ev) => {
    let sev: Severity = "low";
    if (ev.severity === "critical" || ev.severity === "high" || ev.severity === "medium" || ev.severity === "low") {
      sev = ev.severity;
    }
    return {
      date: ev.date || refDate,
      title: ev.title || "Udalosť",
      detail: ev.detail || "",
      severity: sev,
    };
  });

  return {
    id: unified.id,
    name: caseName,
    subtitle: caseSubtitle,
    referenceDate: refDate,
    baseCurrency,
    entities,
    transactions,
    weapons,
    relations,
    events,
    europolSerials: unified.registries?.europolSerials || [],
    validLicences: unified.registries?.validLicences || [],
    orsrAddresses: unified.registries?.orsrAddresses || {},
  };
}

/**
 * Extracts or derives a ForensicDossier from a ForensicCaseUnified instance.
 */
export function mapUnifiedToForensicDossier(
  unified: ForensicCaseUnified
): ForensicDossier | null {
  if (unified.dossier) {
    return {
      ...unified.dossier,
      caseId: unified.id,
      caseTitle: unified.title || unified.name || unified.dossier.caseTitle,
    };
  }

  return null;
}

/**
 * Reverse mapping: Converts an existing ForensicCase (+ optional ForensicDossier)
 * into the ForensicCaseUnified envelope for external export, API interchange, or storage.
 */
export function mapForensicCaseToUnified(
  forensicCase: ForensicCase,
  dossier?: ForensicDossier | null
): ForensicCaseUnified {
  return {
    version: "2.0.0",
    id: forensicCase.id,
    title: forensicCase.name,
    name: forensicCase.name,
    subtitle: forensicCase.subtitle,
    referenceDate: forensicCase.referenceDate,
    baseCurrency: forensicCase.baseCurrency,
    status: "active",
    entities: forensicCase.entities.map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      role: e.role,
      ico: e.ico,
      country: e.country,
      address: e.address,
      x: e.x,
      y: e.y,
      metadata: e.note ? { note: e.note } : undefined,
    })),
    transactions: forensicCase.transactions.map((t) => ({
      id: t.id,
      date: t.date,
      amount: t.amount,
      currency: t.currency,
      fromId: t.fromId,
      toId: t.toId,
      method: t.method,
      description: t.description,
      purpose: t.description,
      originCountry: t.originCountry,
      destinationCountry: t.destinationCountry,
      payerId: t.payerId,
    })),
    weapons: forensicCase.weapons.map((w) => ({
      id: w.id,
      brand: w.brand,
      model: w.model,
      serial: w.serial,
      holderId: w.holderId,
      supplierId: w.supplierId,
      acquiredAt: w.acquiredAt,
      licence: w.licence,
    })),
    relations: forensicCase.relations.map((r) => ({
      fromId: r.fromId,
      toId: r.toId,
      label: r.label,
    })),
    events: forensicCase.events.map((ev) => ({
      date: ev.date,
      title: ev.title,
      detail: ev.detail,
      severity: ev.severity,
    })),
    registries: {
      europolSerials: forensicCase.europolSerials,
      validLicences: forensicCase.validLicences,
      orsrAddresses: forensicCase.orsrAddresses,
    },
    dossier: dossier ?? null,
  };
}
