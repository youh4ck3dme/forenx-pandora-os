import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  extractRootJsonText,
  parseAiJson,
  repairTruncatedJson,
  stripCodeFences,
} from "@/lib/forza/ai/parse-json";

const schema = z.object({ a: z.number(), b: z.array(z.number()).optional() });

describe("parse-json: helpers", () => {
  it("strips markdown code fences", () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("extracts the root JSON from surrounding prose", () => {
    expect(extractRootJsonText('Here you go: {"a":1} hope it helps')).toBe(
      '{"a":1}',
    );
    expect(extractRootJsonText("[1,2,3] trailing")).toBe("[1,2,3]");
    expect(extractRootJsonText("no json here")).toBeNull();
    expect(extractRootJsonText("   ")).toBeNull();
  });

  it("repairs truncated JSON (open array, dangling key, open string)", () => {
    expect(JSON.parse(repairTruncatedJson('{"a":1,"b":[1,2')!)).toEqual({
      a: 1,
      b: [1, 2],
    });
    expect(JSON.parse(repairTruncatedJson('{"a":1,"b":')!)).toEqual({ a: 1 });
    expect(JSON.parse(repairTruncatedJson('{"a":"hel')!)).toEqual({ a: "hel" });
  });

  it("returns complete JSON untouched and null when nothing is recoverable", () => {
    expect(repairTruncatedJson('{"a":1}')).toBe('{"a":1}');
    expect(repairTruncatedJson("plain text")).toBeNull();
  });
});

describe("parse-json: parseAiJson", () => {
  it("parses a valid fenced response", () => {
    const r = parseAiJson('```json\n{"a":1}\n```', schema);
    expect(r).toEqual({ ok: true, data: { a: 1 } });
  });

  it("recovers a token-limit truncated response", () => {
    const r = parseAiJson('{"a":1,"b":[1,2', schema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ a: 1, b: [1, 2] });
  });

  it.each(["", "   ", "\n"])("rejects empty content %j", (raw) => {
    const r = parseAiJson(raw, schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics).toBe("empty_content");
  });

  it("rejects non-string input without throwing", () => {
    const r = parseAiJson(undefined as unknown as string, schema);
    expect(r.ok).toBe(false);
  });

  it("rejects text without a JSON root", () => {
    const r = parseAiJson("Sorry, I cannot help with that.", schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics).toBe("no_root_json");
  });

  it("fails closed when JSON does not match the schema (AI output != evidence)", () => {
    const r = parseAiJson('{"a":"not-a-number"}', schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics).toContain("a:");
  });

  it("caps schema diagnostics at 4 issues and a bounded length", () => {
    const wide = z.object({
      f1: z.string(),
      f2: z.string(),
      f3: z.string(),
      f4: z.string(),
      f5: z.string(),
      f6: z.string(),
    });
    const r = parseAiJson("{}", wide);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diagnostics).toContain("(+2)");
      expect(r.diagnostics.length).toBeLessThanOrEqual(181);
    }
  });

  it("never leaks a huge raw payload into diagnostics", () => {
    const secret = "SECRET_TOKEN_" + "x".repeat(5000);
    const r = parseAiJson("{ " + secret, schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.length).toBeLessThanOrEqual(181);
  });
});
