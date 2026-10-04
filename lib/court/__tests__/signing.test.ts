import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildManifest, canonicalManifestBytes, diffManifest, type CourtPackManifest } from "@/lib/court/manifest";
import {
  FileSigningKeyProvider,
  parseKeyring,
  parseRevokedKeyIds,
  requireActiveKey,
  signCourtPackManifest,
  verifyCourtPackSignature,
  type Keyring,
} from "@/lib/court/signing";

const VERIFY_MJS = join(process.cwd(), "lib", "court", "verify.mjs");
const enc = (s: string) => new TextEncoder().encode(s);

function ed25519Pem() {
  return generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function keyringWith(kid: string, publicKeyPem: string, status: "active" | "revoked" | "pending" = "active"): Keyring {
  return parseKeyring(
    JSON.stringify([{ kid, version: 1, status, validFrom: "2020-01-01T00:00:00Z", revokedAt: null, publicKeyPem }]),
    "v1",
  );
}

describe("Court Pack manifest (lib/court/manifest.ts)", () => {
  it("is deterministic regardless of input file order", () => {
    const a = buildManifest([
      { path: "b.txt", content: enc("beta") },
      { path: "a.txt", content: enc("alpha") },
    ]);
    const b = buildManifest([
      { path: "a.txt", content: enc("alpha") },
      { path: "b.txt", content: enc("beta") },
    ]);
    expect(canonicalManifestBytes(a).toString()).toBe(canonicalManifestBytes(b).toString());
    expect(a.files[0]!.path).toBe("a.txt");
  });

  it("rejects duplicate paths", () => {
    expect(() => buildManifest([{ path: "x", content: enc("1") }, { path: "x", content: enc("2") }])).toThrow(/Duplicate/);
  });

  it("diffManifest names the exact tampered artifact", () => {
    const ref = buildManifest([{ path: "report.txt", content: enc("clean") }]);
    const tampered = buildManifest([{ path: "report.txt", content: enc("TAMPERED") }]);
    const result = diffManifest(ref, tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failingArtifact).toBe("report.txt");
  });
});

describe("Court Pack signing (lib/court/signing.ts)", () => {
  let tmp: string;
  let keyPath: string;
  let publicKeyPem: string;
  const provider = new FileSigningKeyProvider({ enforcePermissions: false });
  const KID = "pandora-court-2026-01";

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "court-sign-"));
    const { publicKey, privateKey } = ed25519Pem();
    publicKeyPem = publicKey;
    keyPath = join(tmp, "ed25519.pem");
    writeFileSync(keyPath, privateKey, { mode: 0o600 });
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function sampleManifest(): CourtPackManifest {
    return buildManifest([
      { path: "report.txt", content: enc("findings") },
      { path: "chain-of-custody.json", content: enc('{"rows":[]}') },
    ]);
  }

  it("signs and verifies a valid Court Pack (roundtrip)", () => {
    const manifest = sampleManifest();
    const keyring = keyringWith(KID, publicKeyPem);
    const sig = signCourtPackManifest({
      manifest,
      kid: KID,
      keyRef: `file:${keyPath}`,
      keyring,
      revoked: new Set(),
      provider,
    });
    expect(sig.algorithm).toBe("Ed25519");
    expect(sig.kid).toBe(KID);
    expect(verifyCourtPackSignature(manifest, sig, { keyring })).toEqual({ ok: true });
  });

  it("rejects a tampered manifest at verification", () => {
    const manifest = sampleManifest();
    const keyring = keyringWith(KID, publicKeyPem);
    const sig = signCourtPackManifest({ manifest, kid: KID, keyRef: `file:${keyPath}`, keyring, revoked: new Set(), provider });
    const tampered = sampleManifest();
    tampered.files[0]!.sha256 = "0".repeat(64);
    const result = verifyCourtPackSignature(tampered, sig, { keyring });
    expect(result.ok).toBe(false);
  });

  it("refuses to sign when the private key does not match the kid's public key", () => {
    const manifest = sampleManifest();
    const otherPublic = ed25519Pem().publicKey; // keyring advertises a DIFFERENT public key
    const keyring = keyringWith(KID, otherPublic);
    expect(() =>
      signCourtPackManifest({ manifest, kid: KID, keyRef: `file:${keyPath}`, keyring, revoked: new Set(), provider }),
    ).toThrow(/does not correspond to kid/);
  });

  it("refuses an unknown kid", () => {
    const keyring = keyringWith(KID, publicKeyPem);
    expect(() => requireActiveKey(keyring, "no-such-kid", new Set(), new Date())).toThrow(/Unknown signing kid/);
  });

  it("refuses a revoked kid (revocation list and keyring status)", () => {
    const manifest = sampleManifest();
    const keyring = keyringWith(KID, publicKeyPem);
    expect(() =>
      signCourtPackManifest({ manifest, kid: KID, keyRef: `file:${keyPath}`, keyring, revoked: parseRevokedKeyIds(KID), provider }),
    ).toThrow(/revoked/);

    const revokedRing = keyringWith(KID, publicKeyPem, "revoked");
    expect(() =>
      signCourtPackManifest({ manifest, kid: KID, keyRef: `file:${keyPath}`, keyring: revokedRing, revoked: new Set(), provider }),
    ).toThrow(/revoked/);

    // A pack signed earlier must also fail verification once the kid is revoked.
    const goodSig = signCourtPackManifest({ manifest, kid: KID, keyRef: `file:${keyPath}`, keyring, revoked: new Set(), provider });
    expect(verifyCourtPackSignature(manifest, goodSig, { revoked: parseRevokedKeyIds(KID) }).ok).toBe(false);
  });

  it("rejects a non-Ed25519 signing key", () => {
    const rsaPath = join(tmp, "rsa.pem");
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    writeFileSync(rsaPath, privateKey, { mode: 0o600 });
    const keyring = keyringWith(KID, publicKeyPem);
    expect(() =>
      signCourtPackManifest({ manifest: sampleManifest(), kid: KID, keyRef: `file:${rsaPath}`, keyring, revoked: new Set(), provider }),
    ).toThrow(/not Ed25519|does not correspond/);
  });

  it("never exposes the private key path content on a missing-file error", () => {
    expect(() => provider.loadPrivateKeyPem("file:/nonexistent/key.pem")).toThrow(/not found/);
  });
});

describe("Court Pack offline verifier (lib/court/verify.mjs)", () => {
  let tmp: string;
  let keyPath: string;
  let publicKeyPem: string;
  const provider = new FileSigningKeyProvider({ enforcePermissions: false });
  const KID = "pandora-court-offline";

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "court-offline-"));
    const { publicKey, privateKey } = ed25519Pem();
    publicKeyPem = publicKey;
    keyPath = join(tmp, "ed25519.pem");
    writeFileSync(keyPath, privateKey, { mode: 0o600 });
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function writePack(dir: string, files: Record<string, string>) {
    mkdirSync(dir, { recursive: true });
    const inputs = Object.entries(files).map(([path, content]) => ({ path, content: enc(content) }));
    const manifest = buildManifest(inputs);
    const sig = signCourtPackManifest({ manifest, kid: KID, keyRef: `file:${keyPath}`, keyring: keyringWith(KID, publicKeyPem), revoked: new Set(), provider });
    for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "signature.json"), JSON.stringify(sig));
  }

  it("VERIFIES an untampered pack offline with no secret (exit 0)", () => {
    const dir = join(tmp, "pack-ok");
    writePack(dir, { "report.txt": "findings", "hashes.json": '{"a":1}' });
    const out = execFileSync("node", [VERIFY_MJS, dir], { encoding: "utf8" });
    expect(out).toMatch(/VERIFIED/);
  });

  it("FAILS and names the exact artifact when a byte is tampered", () => {
    const dir = join(tmp, "pack-tampered");
    writePack(dir, { "report.txt": "findings", "hashes.json": '{"a":1}' });
    writeFileSync(join(dir, "report.txt"), "findings TAMPERED");
    let code = 0;
    let stderr = "";
    try {
      execFileSync("node", [VERIFY_MJS, dir], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      const e = error as { status?: number; stderr?: string };
      code = e.status ?? 1;
      stderr = e.stderr ?? "";
    }
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/report\.txt/);
  });

  it("FAILS when the signing kid is passed as revoked", () => {
    const dir = join(tmp, "pack-revoked");
    writePack(dir, { "report.txt": "findings" });
    let code = 0;
    try {
      execFileSync("node", [VERIFY_MJS, dir, "--revoked", KID], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      code = (error as { status?: number }).status ?? 1;
    }
    expect(code).not.toBe(0);
  });
});
