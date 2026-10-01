/**
 * P6 & N-06: Bezpečné získavanie klientskej IP adresy z reverzného proxy.
 *
 * Bezpečnostné invarianty:
 * 1. Zákaz dôvery prvej hodnote `x-forwarded-for`: Klient môže do požiadavky
 *    vložiť vlastnú hlavičku `X-Forwarded-For: 1.2.3.4`. Apache reverzná proxy
 *    na VPS (porty 80/443 -> loopback :3005) pridáva skutočnú prichádzajúcu IP
 *    na KONIEC zoznamu: `1.2.3.4, 203.0.113.195`. Čítanie indexu [0] znamená,
 *    že útočník úspešne podvrhol identitu pre audit log aj rate limiter!
 * 2. Posledná IP v reťazci `x-forwarded-for` (alebo prepísaná `x-real-ip`) je
 *    tá, ktorú pripojila Apache reverzná proxy z overeného TCP socketu.
 * 3. Validácia formátu: Každá IP adresa musí spĺňať striktný formát IPv4 alebo
 *    IPv6; neplatné reťazce, injection payloady alebo prázdne hodnoty sú
 *    okamžite odmietnuté a nahradené bezpečným fallbackom.
 */

import { isIP } from "node:net";

export function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  const trimmed = ip.trim();
  if (isIP(trimmed) !== 0) return true;
  if (trimmed.toLowerCase().startsWith("::ffff:") && isIP(trimmed.slice(7)) === 4) {
    return true;
  }
  return false;
}

/**
 * Normalizuje IPv4-mapped IPv6 adresu (napr. ::ffff:192.0.2.1 -> 192.0.2.1).
 */
export function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed.toLowerCase().startsWith("::ffff:")) {
    const v4 = trimmed.slice(7);
    if (isIP(v4) === 4) return v4;
  }
  return trimmed;
}

type HeaderSource = Headers | { get(name: string): string | null | undefined } | Record<string, string | string[] | undefined>;

function getHeaderValue(headers: HeaderSource, name: string): string | null {
  if ("get" in headers && typeof headers.get === "function") {
    return headers.get(name) || headers.get(name.toLowerCase()) || null;
  }
  const dict = headers as Record<string, string | string[] | undefined>;
  const val = dict[name] || dict[name.toLowerCase()];
  if (Array.isArray(val)) return val[0] || null;
  return val || null;
}

/**
 * Extrahuje dôveryhodnú klientsku IP adresu z požiadavky za Apache reverznou proxy.
 *
 * @param req Požiadavka (NextRequest, Request) alebo Headers
 * @param fallback Bezpečná predvolená adresa pri absencii platnej IP (default '127.0.0.1')
 */
export function getTrustedClientIp(
  req: { headers: HeaderSource } | HeaderSource,
  fallback = "127.0.0.1",
): string {
  const headers = "headers" in req && req.headers ? (req.headers as HeaderSource) : (req as HeaderSource);

  // 1. Priorita: X-Real-IP (Apache mod_remoteip / mod_proxy nastavuje alebo prepisuje túto hlavičku)
  const realIp = getHeaderValue(headers, "x-real-ip");
  if (realIp) {
    const cleaned = realIp.trim();
    if (isValidIp(cleaned)) {
      return normalizeIp(cleaned);
    }
  }

  // 2. X-Forwarded-For: výber POSLEDNEJ validnej IP adresy v reťazci (najbližšej k Apache proxy)
  const forwardedFor = getHeaderValue(headers, "x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);

    // Hľadáme od konca zoznamu (posledný hop pridaný Apache proxy)
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = hops[i];
      if (isValidIp(hop)) {
        return normalizeIp(hop);
      }
    }
  }

  return fallback;
}
