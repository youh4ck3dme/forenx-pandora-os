import { isIP } from "node:net";

export type ExternalUrlValidation =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

function isBlockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [first, second] = octets;
  if (
    octets.length !== 4 ||
    first === undefined ||
    second === undefined ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true;
  }
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }
  const mappedV4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedV4?.[1]) return isBlockedIpv4(mappedV4[1]);
  const mappedV4Hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedV4Hex?.[1] && mappedV4Hex[2]) {
    const high = Number.parseInt(mappedV4Hex[1], 16);
    const low = Number.parseInt(mappedV4Hex[2], 16);
    const mappedAddress = [
      (high >> 8) & 0xff,
      high & 0xff,
      (low >> 8) & 0xff,
      low & 0xff,
    ].join(".");
    return isBlockedIpv4(mappedAddress);
  }
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
}

export function validateExternalUrl(rawUrl: string): ExternalUrlValidation {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") {
      return { ok: false, reason: "Povolené sú iba HTTPS odkazy." };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, reason: "URL nesmie obsahovať prihlasovacie údaje." };
    }

    // WHATWG URL keeps brackets around IPv6 literals in `hostname`.
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return { ok: false, reason: "Lokálne a interné adresy sú zakázané." };
    }

    const family = isIP(hostname);
    if (
      (family === 4 && isBlockedIpv4(hostname)) ||
      (family === 6 && isBlockedIpv6(hostname))
    ) {
      return { ok: false, reason: "Privátna alebo loopback adresa je zakázaná." };
    }
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, reason: "Neplatná URL." };
  }
}
