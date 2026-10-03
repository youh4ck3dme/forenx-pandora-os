import { describe, it, expect } from "vitest";
import { getTrustedClientIp, isValidIp, normalizeIp } from "../client-ip";

describe("lib/security/client-ip", () => {
  describe("isValidIp & normalizeIp", () => {
    it("validuje správne IPv4 adresy", () => {
      expect(isValidIp("127.0.0.1")).toBe(true);
      expect(isValidIp("203.0.113.195")).toBe(true);
      expect(isValidIp("10.0.0.1")).toBe(true);
      expect(isValidIp("255.255.255.255")).toBe(true);
    });

    it("odmieta neplatné IPv4 adresy a injection payloady", () => {
      expect(isValidIp("256.0.0.1")).toBe(false);
      expect(isValidIp("127.0.0")).toBe(false);
      expect(isValidIp("127.0.0.1.5")).toBe(false);
      expect(isValidIp("0127.0.0.1")).toBe(false); // octal prefix
      expect(isValidIp("127.0.0.01")).toBe(false);
      expect(isValidIp("<script>alert(1)</script>")).toBe(false);
      expect(isValidIp("127.0.0.1; DROP TABLE")).toBe(false);
      expect(isValidIp("")).toBe(false);
    });

    it("validuje správne IPv6 adresy", () => {
      expect(isValidIp("::1")).toBe(true);
      expect(isValidIp("2001:db8::1")).toBe(true);
      expect(isValidIp("fe80::1ff:fe23:4567:890a")).toBe(true);
      expect(isValidIp("::ffff:192.0.2.1")).toBe(true);
    });

    it("normalizuje IPv4-mapped IPv6 adresu", () => {
      expect(normalizeIp("::ffff:192.0.2.1")).toBe("192.0.2.1");
      expect(normalizeIp("127.0.0.1")).toBe("127.0.0.1");
    });
  });

  describe("getTrustedClientIp — ochrana pred spoofingom (P6 & N-06)", () => {
    it("uprednostní platnú X-Real-IP nastavenú Apache proxy", () => {
      const headers = new Headers({
        "x-real-ip": "198.51.100.22",
        "x-forwarded-for": "1.1.1.1, 198.51.100.22",
      });
      expect(getTrustedClientIp({ headers })).toBe("198.51.100.22");
    });

    it("pri viacnásobnom X-Forwarded-For vyberie POSLEDNÚ pridanú IP (odmietne podvrhnutú prvú)", () => {
      // Útočník poslal: X-Forwarded-For: 1.2.3.4 (podvrh)
      // Apache proxy pripojil skutočnú IP klienta: 203.0.113.88
      const headers = new Headers({
        "x-forwarded-for": "1.2.3.4, 203.0.113.88",
      });
      // Nesmie vrátiť 1.2.3.4!
      expect(getTrustedClientIp({ headers })).toBe("203.0.113.88");
    });

    it("zvládne reťazec viacerých spoofnutých hopov a vyberie posledný platný", () => {
      const headers = new Headers({
        "x-forwarded-for": "10.0.0.1, 172.16.0.1, 192.168.1.1, 198.51.100.5",
      });
      expect(getTrustedClientIp({ headers })).toBe("198.51.100.5");
    });

    it("odmietne neplatný posledný hop a vráti fallback (skorší hop nepoužije)", () => {
      const headers = new Headers({
        "x-forwarded-for": "203.0.113.50, invalid-ip-injection",
      });
      expect(getTrustedClientIp({ headers }, "127.0.0.1")).toBe("127.0.0.1");
    });

    it("použije fallback ak sú všetky hlavičky neplatné alebo prázdne", () => {
      const headers = new Headers({
        "x-forwarded-for": "malicious payload, not-an-ip",
      });
      expect(getTrustedClientIp({ headers }, "127.0.0.1")).toBe("127.0.0.1");
    });

    it("funguje aj s čistým Headers objektom alebo NextRequest objektom", () => {
      const headers = new Headers({ "x-real-ip": "198.51.100.77" });
      expect(getTrustedClientIp(headers)).toBe("198.51.100.77");

      const reqLike = {
        headers: {
          get: (name: string) => (name.toLowerCase() === "x-real-ip" ? "198.51.100.77" : null),
        },
      };
      expect(getTrustedClientIp(reqLike as any)).toBe("198.51.100.77");
    });
  });
});
