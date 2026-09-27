import { describe, expect, it } from "vitest";
import {
  CanonicalizationError,
  canonicalJson,
  canonicalSha256,
} from "../provenance/canonical";
import { sha256Hex, sha256HexBytes } from "../provenance/sha256";
import { captureResponse } from "../provenance/source-snapshot";
import {
  buildReportManifest,
  verifyReportManifest,
} from "../provenance/report-manifest";
import {
  stripEmbeddedManifest,
  withEmbeddedManifest,
} from "../export-pdf";

describe("canonical serializer", () => {
  it("hashes objects independently of key order", () => {
    expect(canonicalSha256({ a: 1, b: 2 })).toBe(canonicalSha256({ b: 2, a: 1 }));
    expect(canonicalJson({ b: { d: 1, c: [2, 1] }, a: 1 })).toBe('{"a":1,"b":{"c":[2,1],"d":1}}');
  });

  it("changes the hash when a value changes", () => {
    expect(canonicalSha256({ a: 1, b: 2 })).not.toBe(canonicalSha256({ a: 1, b: 3 }));
  });

  it("keeps array order significant", () => {
    expect(canonicalSha256([1, 2])).not.toBe(canonicalSha256([2, 1]));
  });

  it("normalises Unicode to NFC", () => {
    const decomposed = "Jaň"; // J + a + n + combining caron
    const precomposed = "Jaň";
    expect(canonicalSha256({ name: decomposed.normalize("NFD") })).toBe(
      canonicalSha256({ name: "Jaň".normalize("NFD").normalize("NFC") }),
    );
    expect(canonicalJson("Žílina")).toBe(canonicalJson("Žílina"));
    expect(precomposed).toBeTruthy();
  });

  it("rejects values that would silently change meaning", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(CanonicalizationError);
    expect(() => canonicalJson([undefined])).toThrow(CanonicalizationError);
    expect(() => canonicalJson({ a: BigInt(1) })).toThrow(CanonicalizationError);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(CanonicalizationError);
  });

  it("uses locale-independent number and date formatting", () => {
    expect(canonicalJson({ n: 1234.5, z: -0, d: new Date("2024-01-02T03:04:05Z") })).toBe(
      '{"d":"2024-01-02T03:04:05.000Z","n":1234.5,"z":0}',
    );
  });
});

describe("sha256", () => {
  it("matches FIPS 180-4 test vectors", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256HexBytes(new Uint8Array([0xff, 0x00]))).toHaveLength(64);
  });
});

describe("source snapshot", () => {
  it("hashes the original response bytes and records HTTP metadata", async () => {
    const body = new TextEncoder().encode('{"ico":"12345678"}');
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "application/json", etag: '"v1"' },
    });
    const { snapshot, bytes } = await captureResponse(response, {
      source: "orsr",
      parserVersion: "orsr-parser-1",
      now: () => new Date("2026-09-27T10:00:00Z"),
    });
    expect(Array.from(bytes)).toEqual(Array.from(body));
    expect(snapshot).toMatchObject({
      source: "orsr",
      http_status: 200,
      retrieved_at: "2026-09-27T10:00:00.000Z",
      content_type: "application/json",
      parser_version: "orsr-parser-1",
      raw_sha256: sha256HexBytes(body),
      byte_size: body.byteLength,
      etag: '"v1"',
    });
  });
});

describe("report manifest", () => {
  const content = { caseId: "C-1", findings: [{ id: 1, text: "Prevod 10 000 €" }] };
  const reportText = "<html><body>Report</body></html>";

  it("verifies an untouched report", () => {
    const { manifest, manifestSha256 } = buildReportManifest({
      subjectId: "C-1",
      reportText,
      content,
      rulesetVersion: "2026.09.1",
      sourceSnapshotHashes: ["b".repeat(64), "a".repeat(64)],
      generatedAt: new Date("2026-09-27T00:00:00Z"),
    });
    expect(manifest.signature).toBe("unsigned");
    expect(manifest.source_snapshot_hashes).toEqual(["a".repeat(64), "b".repeat(64)]);
    expect(verifyReportManifest(manifest, manifestSha256, reportText, content)).toEqual({ ok: true });
  });

  it("detects tampering with the report, the content, or the manifest", () => {
    const { manifest, manifestSha256 } = buildReportManifest({
      subjectId: "C-1",
      reportText,
      content,
      rulesetVersion: "2026.09.1",
    });
    expect(
      verifyReportManifest(manifest, manifestSha256, reportText.replace("Report", "Rep0rt"), content),
    ).toEqual({ ok: false, reason: "report" });
    expect(
      verifyReportManifest(manifest, manifestSha256, reportText, {
        ...content,
        findings: [{ id: 1, text: "Prevod 1 000 €" }],
      }),
    ).toEqual({ ok: false, reason: "content" });
    expect(
      verifyReportManifest({ ...manifest, ruleset_version: "x" }, manifestSha256, reportText, content),
    ).toEqual({ ok: false, reason: "manifest" });
  });

  it("embeds the manifest without changing the hashed report text", () => {
    const { manifest, manifestSha256 } = buildReportManifest({
      subjectId: "C-1",
      reportText,
      content,
      rulesetVersion: "r",
    });
    const hostile = { ...manifest, subject_id: "</script><script>alert(1)</script>" };
    const embedded = withEmbeddedManifest(reportText, hostile, manifestSha256);
    expect(embedded).not.toContain("</script><script>");
    expect(stripEmbeddedManifest(embedded)).toBe(reportText);
  });
});
