import { describe, expect, it } from "vitest";
import { validateExternalUrl } from "../network-security";

describe("external URL security", () => {
  it.each([
    "file:///C:/Windows/System32/drivers/etc/hosts",
    "http://example.com",
    "https://localhost",
    "https://127.1.1.1",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.1.1",
    "https://169.254.169.254",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://[::ffff:7f00:1]",
    "https://[fc00::1]",
    "https://[fe80::1]",
    "https://user:password@example.com",
  ])("blocks unsafe external URL %s", (url) => {
    expect(validateExternalUrl(url).ok).toBe(false);
  });

  it("allows a public HTTPS URL", () => {
    expect(validateExternalUrl("https://whoiswho.at/path?case=1")).toEqual({
      ok: true,
      url: "https://whoiswho.at/path?case=1",
    });
  });
});
