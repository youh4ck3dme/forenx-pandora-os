import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ForensicSyncReceiver,
  ForensicSyncClient,
  computeSha256,
  computeChainHash,
  signPayload,
  verifyPayloadSignature,
  makeCaseId,
  makeEvidenceId,
  makeNodeId,
  makeSha256Hash,
  GENESIS_HASH,
} from "../services/forensic-sync";

describe("Forensic WebSocket Synchronization Engine", () => {
  const secretKey = "super-secret-forensic-key-32bytes!";
  const caseId = makeCaseId("case-sk-2026-001");
  const evidenceId = makeEvidenceId("evidence-hdd-dump-01");

  describe("Kryptografické funkcie (Hash Chain & Signatures)", () => {
    it("computeSha256 vracia deterministický 64-znakový hex hash", async () => {
      const hash1 = await computeSha256("test-forensic-data");
      const hash2 = await computeSha256("test-forensic-data");
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("computeChainHash spája prevHash a payload", async () => {
      const payload = "chunk-data-1";
      const hash = await computeChainHash(GENESIS_HASH, payload);
      const expected = await computeSha256(`${GENESIS_HASH}:${payload}`);
      expect(hash).toBe(expected);
    });

    it("signPayload a verifyPayloadSignature správne overujú platnosť podpisu", async () => {
      const payload = "forensic-packet-xyz";
      const signature = await signPayload(payload, secretKey);
      
      const isValid = await verifyPayloadSignature(payload, signature, secretKey);
      expect(isValid).toBe(true);

      const isInvalidTampered = await verifyPayloadSignature("tampered-data", signature, secretKey);
      expect(isInvalidTampered).toBe(false);

      const isInvalidKey = await verifyPayloadSignature(payload, signature, "wrong-key");
      expect(isInvalidKey).toBe(false);
    });
  });

  describe("ForensicSyncReceiver (Server-Side Ingest & Validation)", () => {
    let receiver: ForensicSyncReceiver;
    let auditLogs: string[];

    beforeEach(() => {
      auditLogs = [];
      receiver = new ForensicSyncReceiver({
        secretKey,
        maxBufferedBytes: 1024 * 1024, // 1 MB limit
        auditSink: (json) => auditLogs.push(json),
      });
    });

    it("úspešne overí a prijme legitímny SYNC_DELTA frame a vráti ACK", async () => {
      const client = new ForensicSyncClient({ caseId, evidenceId, secretKey });
      const chunkResult = await client.createChunk("sample forensic payload");
      expect(chunkResult.ok).toBe(true);
      if (!chunkResult.ok) return;

      const rawMsg = JSON.stringify(chunkResult.value);
      const ingestResult = await receiver.ingestRawFrame(rawMsg, 0, "192.168.1.50");

      expect(ingestResult.ok).toBe(true);
      if (ingestResult.ok) {
        expect(ingestResult.value.type).toBe("ACK");
        if (ingestResult.value.type === "ACK") {
          expect(ingestResult.value.ackSeq).toBe(1);
          expect(ingestResult.value.evidenceId).toBe(evidenceId);
        }
      }

      const chainState = receiver.getChainState(evidenceId);
      expect(chainState).toBeDefined();
      expect(chainState?.verifiedChunks.length).toBe(1);
      expect(chainState?.lastSeq).toBe(1);
      expect(chainState?.lastHash).toBe(chunkResult.value.currentHash);

      // Audit log overený
      expect(auditLogs.some((l) => l.includes("CHUNK_VERIFIED") && l.includes("VERIFIED"))).toBe(true);
    });

    it("odmietne frame pri neplatnom podpise (UNAUTHORIZED_SIGNATURE)", async () => {
      const client = new ForensicSyncClient({ caseId, evidenceId, secretKey: "fake-key" });
      const chunkResult = await client.createChunk("fake payload");
      if (!chunkResult.ok) return;

      const rawMsg = JSON.stringify(chunkResult.value);
      const ingestResult = await receiver.ingestRawFrame(rawMsg, 0);

      expect(ingestResult.ok).toBe(false);
      if (!ingestResult.ok) {
        expect(ingestResult.error.code).toBe("UNAUTHORIZED_SIGNATURE");
      }
    });

    it("odmietne frame doručený mimo poradia (OUT_OF_SEQUENCE)", async () => {
      const client = new ForensicSyncClient({ caseId, evidenceId, secretKey });
      await client.createChunk("chunk 1"); // seq 1
      const chunk2 = await client.createChunk("chunk 2"); // seq 2
      if (!chunk2.ok) return;

      // Pokus poslať chunk 2 pred chunkom 1
      const rawMsg = JSON.stringify(chunk2.value);
      const ingestResult = await receiver.ingestRawFrame(rawMsg, 0);

      expect(ingestResult.ok).toBe(false);
      if (!ingestResult.ok) {
        expect(ingestResult.error.code).toBe("OUT_OF_SEQUENCE");
        if (ingestResult.error.code === "OUT_OF_SEQUENCE") {
          expect(ingestResult.error.expectedSeq).toBe(1);
          expect(ingestResult.error.receivedSeq).toBe(2);
        }
      }
    });

    it("odmietne frame s porušeným hash reťazcom (HASH_MISMATCH)", async () => {
      const client = new ForensicSyncClient({ caseId, evidenceId, secretKey });
      const chunkResult = await client.createChunk("valid payload");
      if (!chunkResult.ok) return;

      // Manipulácia s prevHash
      const tamperedFrame = {
        ...chunkResult.value,
        prevHash: makeSha256Hash("1".repeat(64)),
      };

      const rawMsg = JSON.stringify(tamperedFrame);
      const ingestResult = await receiver.ingestRawFrame(rawMsg, 0);

      expect(ingestResult.ok).toBe(false);
      if (!ingestResult.ok) {
        expect(ingestResult.error.code).toBe("HASH_MISMATCH");
      }
    });

    it("aplikuje backpressure pri prekročení limitu buffera (BACKPRESSURE_OVERFLOW)", async () => {
      const client = new ForensicSyncClient({ caseId, evidenceId, secretKey });
      const chunk = await client.createChunk("data");
      if (!chunk.ok) return;

      // Simulácia zaplnenia buffera nad 1MB
      const highWatermark = 2 * 1024 * 1024;
      const ingestResult = await receiver.ingestRawFrame(JSON.stringify(chunk.value), highWatermark);

      expect(ingestResult.ok).toBe(false);
      if (!ingestResult.ok) {
        expect(ingestResult.error.code).toBe("BACKPRESSURE_OVERFLOW");
      }
    });

    it("správne spracuje HEARTBEAT správy", async () => {
      const heartbeatMsg = JSON.stringify({
        type: "HEARTBEAT",
        nodeId: "forensic-node-eu-01",
        timestamp: Date.now(),
      });

      const ingestResult = await receiver.ingestRawFrame(heartbeatMsg, 0);
      expect(ingestResult.ok).toBe(true);
      if (ingestResult.ok) {
        expect(ingestResult.value.type).toBe("HEARTBEAT");
      }
    });

    it("zlyhá na neplatnej schéme (SCHEMA_VIOLATION)", async () => {
      const malformedJson = "{ not-json }";
      const result = await receiver.ingestRawFrame(malformedJson, 0);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("SCHEMA_VIOLATION");
      }
    });
  });

  describe("ForensicSyncClient (Client-Side State & Jitter Backoff)", () => {
    it("správne inkrementuje seq a ukladá do offline fronty", async () => {
      const client = new ForensicSyncClient({ caseId, evidenceId, secretKey });
      client.setConnectionState(false);

      const chunk1 = await client.createChunk("first");
      const chunk2 = await client.createChunk("second");

      expect(chunk1.ok && chunk2.ok).toBe(true);
      if (chunk1.ok && chunk2.ok) {
        expect(chunk1.value.seq).toBe(1);
        expect(chunk2.value.seq).toBe(2);
        expect(chunk2.value.prevHash).toBe(chunk1.value.currentHash);
      }

      expect(client.getQueueLength()).toBe(2);
      const flushed = client.flushQueue();
      expect(flushed.length).toBe(2);
      expect(client.getQueueLength()).toBe(0);
    });

    it("calculateBackoffDelay počíta Full Jitter v platnom intervale", () => {
      const client = new ForensicSyncClient({
        caseId,
        evidenceId,
        secretKey,
        initialBackoffMs: 1000,
        maxBackoffMs: 8000,
      });

      for (let attempt = 0; attempt < 5; attempt++) {
        const delay = client.calculateBackoffDelay(attempt);
        const maxPossible = Math.min(8000, 1000 * Math.pow(2, attempt));
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(maxPossible);
      }
    });
  });
});
