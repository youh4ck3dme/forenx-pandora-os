import type { TimelineEvent, SourceRef } from "../types";

/**
 * Normalizuje dátumový reťazec do ISO formátu alebo ponecháva pôvodný text, ak nie je parsovateľný.
 */
export function normalizeEventTimestamp(rawTime: string): string {
  if (!rawTime) return new Date().toISOString();
  const trimmed = rawTime.trim();

  // Skús formát DD.MM.YYYY [HH:mm]
  const dmyMatch = trimmed.match(/^([0-3]?[0-9])\.([0-1]?[0-9])\.([12][09][0-9]{2})(?:\s+([0-2]?[0-9]):([0-5][0-9]))?/);
  if (dmyMatch) {
    const day = dmyMatch[1]!.padStart(2, "0");
    const month = dmyMatch[2]!.padStart(2, "0");
    const year = dmyMatch[3]!;
    const hours = dmyMatch[4] ? dmyMatch[4].padStart(2, "0") : "12";
    const minutes = dmyMatch[5] ? dmyMatch[5].padStart(2, "0") : "00";
    const parsed = new Date(`${year}-${month}-${day}T${hours}:${minutes}:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  return trimmed;
}

/**
 * Zoradí udalosti časovej osi vzostupne podľa času.
 */
export function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    const timeA = new Date(a.time).getTime();
    const timeB = new Date(b.time).getTime();
    if (!Number.isNaN(timeA) && !Number.isNaN(timeB)) {
      return timeA - timeB;
    }
    return a.time.localeCompare(b.time);
  });
}

/**
 * Overuje integritu reťazca zaistenia (chain of custody) medzi chronologickými udalosťami.
 * Ak je medzi udalosťami podozrivo dlhá časová medzera alebo chýba zdroj, označí udalosť ako chainBreak.
 */
export function detectChainBreaks(events: TimelineEvent[]): TimelineEvent[] {
  const sorted = sortTimelineEvents(events);
  const result: TimelineEvent[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = { ...sorted[i]! };
    // Ak už udalosť explicitne definuje chainBreak, zachováme ju
    if (typeof current.chainBreak === "boolean") {
      result.push(current);
      continue;
    }

    // Ak chýba zdroj alebo paragraf pri kritických úkonoch zaistenia
    const isCritical = current.severity === "critical" || /zaistenie|odber|prehliadka/i.test(current.event);
    const missingProof = !current.source || current.source.toLowerCase().includes("neznámy") || current.source.toLowerCase().includes("neuvedený");

    if (isCritical && missingProof) {
      current.chainBreak = true;
    }

    result.push(current);
  }

  return result;
}

/**
 * Zlúči udalosti z viacerých čiastkových analýz spisu (chunks) a odstráni duplicity.
 */
export function mergeTimelineEvents(
  existingEvents: TimelineEvent[],
  newEvents: TimelineEvent[],
): TimelineEvent[] {
  const seen = new Set<string>();
  const combined: TimelineEvent[] = [];

  for (const ev of [...existingEvents, ...newEvents]) {
    const key = `${ev.time}::${ev.event.trim().toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      combined.push(ev);
    }
  }

  return detectChainBreaks(sortTimelineEvents(combined));
}

/**
 * Vytvorí štruktúrovanú udalosť časovej osi so zabezpečením všetkých požadovaných polí.
 */
export function createTimelineEvent(input: {
  time: string;
  event: string;
  source: string;
  chainBreak?: boolean;
  paragraph?: string;
  sourceRef?: SourceRef;
  severity?: "critical" | "warning" | "info";
}): TimelineEvent {
  return {
    time: normalizeEventTimestamp(input.time),
    event: input.event.trim(),
    source: input.source.trim(),
    chainBreak: Boolean(input.chainBreak),
    ...(input.paragraph ? { paragraph: input.paragraph.trim() } : {}),
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    severity: input.severity ?? "info",
  };
}
