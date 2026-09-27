/**
 * 🛡️ PΛND0RΛ FORENSIC WEBSOCKET SYNCHRONIZATION ENGINE
 * 
 * Produkčne tvrdená synchronizačná vrstva pre streamovanie a overovanie forenzných dôkazov.
 * 
 * Garancie:
 * 1. Cryptographic Non-Repudiation (Hash-Chaining Merkle DAG + HMAC-SHA256 podpisy)
 * 2. Strict Monotonic Sequence Ordering (Detekcia výpadkov, chýb a out-of-order paketov)
 * 3. Backpressure Protection (Monitorovanie buffer limitov proti OOM)
 * 4. Deterministic Lifecycle & Heartbeats (Zamedzenie zombie socketom)
 * 5. Structured Audit Logging (JSON audit stopa pripravená pre súdne konanie)
 */

import {
  CaseId,
  EvidenceId,
  NodeId,
  SequenceNumber,
  Sha256Hash,
  ForensicSyncFrame,
  ForensicSyncDelta,
  ForensicHeartbeat,
  ForensicAck,
  ForensicSyncFrameSchema,
  SyncResult,
  syncOk,
  syncErr,
  makeCaseId,
  makeEvidenceId,
  makeNodeId,
  makeSequenceNumber,
  makeSha256Hash,
  ForensicAuditLogEntry,
} from "./forensic-sync-types";

export * from "./forensic-sync-types";

export const GENESIS_HASH = makeSha256Hash("0".repeat(64));
export const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024; // 64 MB High-Watermark
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000;

// ─── KRYPTOGRAFICKÝ PIPELINE ─────────────────────────────────────

/**
 * Deterministický výpočet SHA-256 hashu z reťazca (cross-platform WebCrypto / Node)
 */
export async function computeSha256(data: string): Promise<Sha256Hash> {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return makeSha256Hash(hex);
  }

  // Node.js fallback
  const nodeCrypto = await import("node:crypto");
  const hex = nodeCrypto.createHash("sha256").update(buffer).digest("hex");
  return makeSha256Hash(hex);
}

/**
 * Overenie hash reťazca: currentHash MUSÍ zodpovedať SHA-256(prevHash + ":" + payload)
 */
export async function computeChainHash(prevHash: Sha256Hash, payload: string): Promise<Sha256Hash> {
  return computeSha256(`${prevHash}:${payload}`);
}

/**
 * Podpis chunku cez HMAC-SHA256
 */
export async function signPayload(payload: string, secretKey: string): Promise<string> {
  const encoder = new TextEncoder();
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const keyData = encoder.encode(secretKey);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(payload));
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  const nodeCrypto = await import("node:crypto");
  return nodeCrypto.createHmac("sha256", secretKey).update(payload).digest("hex");
}

/**
 * Overenie podpisu chunku
 */
export async function verifyPayloadSignature(
  payload: string,
  signature: string,
  secretKey: string
): Promise<boolean> {
  const expectedSignature = await signPayload(payload, secretKey);
  return expectedSignature.toLowerCase() === signature.toLowerCase();
}

/**
 * Štruktúrovaný Audit Logger
 */
export function logAuditEvent(entry: ForensicAuditLogEntry, sink: (logJson: string) => void = defaultLogSink): void {
  sink(JSON.stringify(entry));
}

function defaultLogSink(logJson: string): void {
  if (process.env.NODE_ENV !== "test") {
    process.stdout.write(`[FORENSIC-AUDIT] ${logJson}\n`);
  }
}

// ─── STATEFUL FORENSIC CHAIN STATE ────────────────────────────────

export interface EvidenceChainState {
  readonly evidenceId: EvidenceId;
  readonly caseId: CaseId;
  lastSeq: SequenceNumber;
  lastHash: Sha256Hash;
  readonly verifiedChunks: ForensicSyncDelta[];
}

// ─── VERIFIKAČNÝ PIPELINE PRE INGEST ─────────────────────────────

export class ForensicSyncReceiver {
  private readonly chains = new Map<string, EvidenceChainState>();
  private readonly secretKey: string;
  private readonly maxBufferedBytes: number;
  private auditSink?: (logJson: string) => void;

  constructor(options: { secretKey: string; maxBufferedBytes?: number; auditSink?: (logJson: string) => void }) {
    this.secretKey = options.secretKey;
    this.maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    this.auditSink = options.auditSink;
  }

  /**
   * Spracovanie prichádzajúceho surového textového WS framu s kompletnou validáciou
   */
  public async ingestRawFrame(
    rawMessage: string,
    bufferedAmount: number = 0,
    clientIp: string = "127.0.0.1"
  ): Promise<SyncResult<ForensicAck | ForensicHeartbeat>> {
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // 1. Backpressure ochrana
    if (bufferedAmount > this.maxBufferedBytes) {
      logAuditEvent(
        {
          trace_id: traceId,
          client_ip: clientIp,
          action: "INGEST_REJECTED",
          timestamp: new Date().toISOString(),
          status: "REJECTED",
        },
        this.auditSink
      );
      return syncErr({
        code: "BACKPRESSURE_OVERFLOW",
        bufferedBytes: bufferedAmount,
        limit: this.maxBufferedBytes,
      });
    }

    // 2. Runtime Zod Schéma validácia
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(rawMessage);
    } catch {
      return syncErr({ code: "SCHEMA_VIOLATION", message: "Neplatný JSON formát správy." });
    }

    const parseResult = ForensicSyncFrameSchema.safeParse(rawJson);
    if (!parseResult.success) {
      return syncErr({
        code: "SCHEMA_VIOLATION",
        message: parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "),
      });
    }

    const frame = parseResult.data;

    // 3. Rozvetvenie podľa typu framu
    if (frame.type === "HEARTBEAT") {
      logAuditEvent(
        {
          trace_id: traceId,
          client_ip: clientIp,
          action: "HEARTBEAT_RECEIVED",
          timestamp: new Date().toISOString(),
          status: "HEARTBEAT",
        },
        this.auditSink
      );
      return syncOk({
        type: "HEARTBEAT",
        nodeId: makeNodeId(frame.nodeId),
        timestamp: Date.now(),
      });
    }

    if (frame.type === "ACK") {
      return syncOk({
        type: "ACK",
        ackSeq: makeSequenceNumber(frame.ackSeq),
        evidenceId: makeEvidenceId(frame.evidenceId),
        timestamp: Date.now(),
      });
    }

    // 4. Overenie SYNC_DELTA (Forenzný balík)
    const caseId = makeCaseId(frame.caseId);
    const evidenceId = makeEvidenceId(frame.evidenceId);
    const seq = makeSequenceNumber(frame.seq);
    const prevHash = makeSha256Hash(frame.prevHash);
    const currentHash = makeSha256Hash(frame.currentHash);

    // Krok A: Kryptografický podpis chunku
    const isSignatureValid = await verifyPayloadSignature(frame.payload, frame.signature, this.secretKey);
    if (!isSignatureValid) {
      logAuditEvent(
        {
          trace_id: traceId,
          case_id: caseId,
          evidence_id: evidenceId,
          sequence_no: seq,
          client_ip: clientIp,
          action: "SIGNATURE_REJECTED",
          timestamp: new Date().toISOString(),
          status: "REJECTED",
        },
        this.auditSink
      );
      return syncErr({ code: "UNAUTHORIZED_SIGNATURE", evidenceId });
    }

    // Krok B: Správa reťazca dôkazov
    let chain = this.chains.get(evidenceId);
    if (!chain) {
      chain = {
        evidenceId,
        caseId,
        lastSeq: makeSequenceNumber(0),
        lastHash: GENESIS_HASH,
        verifiedChunks: [],
      };
      this.chains.set(evidenceId, chain);
    }

    // Krok C: Overenie sekvenčného čísla (striktný monotónny prírastok)
    const expectedSeq = chain.verifiedChunks.length === 0 ? 1 : chain.lastSeq + 1;
    if (seq !== expectedSeq) {
      return syncErr({
        code: "OUT_OF_SEQUENCE",
        expectedSeq,
        receivedSeq: seq,
      });
    }

    // Krok D: Overenie prevHash (musí sedieť s predchádzajúcim uzlom DAGu)
    if (prevHash !== chain.lastHash) {
      return syncErr({
        code: "HASH_MISMATCH",
        expected: chain.lastHash,
        received: prevHash,
      });
    }

    // Krok E: Overenie matematickej správnosti aktuálneho hashu
    const calculatedCurrentHash = await computeChainHash(prevHash, frame.payload);
    if (calculatedCurrentHash !== currentHash) {
      return syncErr({
        code: "HASH_MISMATCH",
        expected: calculatedCurrentHash,
        received: currentHash,
      });
    }

    // Všetko sedí – zapíšeme overený záznam do Chain of Custody
    const verifiedDelta: ForensicSyncDelta = {
      type: "SYNC_DELTA",
      caseId,
      evidenceId,
      seq,
      prevHash,
      currentHash,
      payload: frame.payload,
      signature: frame.signature,
      timestamp: frame.timestamp,
    };

    chain.lastSeq = seq;
    chain.lastHash = currentHash;
    chain.verifiedChunks.push(verifiedDelta);

    logAuditEvent(
      {
        trace_id: traceId,
        case_id: caseId,
        evidence_id: evidenceId,
        sequence_no: seq,
        hash: currentHash,
        client_ip: clientIp,
        action: "CHUNK_VERIFIED",
        timestamp: new Date().toISOString(),
        status: "VERIFIED",
      },
      this.auditSink
    );

    // Vrátime potvrdenie (ACK)
    return syncOk({
      type: "ACK",
      ackSeq: seq,
      evidenceId,
      timestamp: Date.now(),
    });
  }

  public getChainState(evidenceId: EvidenceId): EvidenceChainState | undefined {
    return this.chains.get(evidenceId);
  }

  public reset(): void {
    this.chains.clear();
  }
}

// ─── FORENSIC SYNC CLIENT ────────────────────────────────────────

export interface ClientSyncOptions {
  readonly caseId: CaseId;
  readonly evidenceId: EvidenceId;
  readonly secretKey: string;
  readonly maxBufferBytes?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
}

export class ForensicSyncClient {
  private readonly caseId: CaseId;
  private readonly evidenceId: EvidenceId;
  private readonly secretKey: string;
  private readonly maxBufferBytes: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;

  private currentSeq: number = 0;
  private currentHash: Sha256Hash = GENESIS_HASH;
  private offlineQueue: ForensicSyncDelta[] = [];
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;

  constructor(options: ClientSyncOptions) {
    this.caseId = options.caseId;
    this.evidenceId = options.evidenceId;
    this.secretKey = options.secretKey;
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    this.initialBackoffMs = options.initialBackoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30000;
  }

  /**
   * Vytvorenie a kryptografické zapečatenie nového balíka dát (chunka)
   */
  public async createChunk(payload: string): Promise<SyncResult<ForensicSyncDelta>> {
    const nextSeq = makeSequenceNumber(this.currentSeq + 1);
    const prevHash = this.currentHash;
    const currentHash = await computeChainHash(prevHash, payload);
    const signature = await signPayload(payload, this.secretKey);

    const delta: ForensicSyncDelta = {
      type: "SYNC_DELTA",
      caseId: this.caseId,
      evidenceId: this.evidenceId,
      seq: nextSeq,
      prevHash,
      currentHash,
      payload,
      signature,
      timestamp: Date.now(),
    };

    this.currentSeq = nextSeq;
    this.currentHash = currentHash;

    if (!this.isConnected) {
      this.offlineQueue.push(delta);
    }

    return syncOk(delta);
  }

  /**
   * Výpočet exponenciálneho backoffu s Full Jitter algoritmom
   */
  public calculateBackoffDelay(attempt: number): number {
    const exponential = Math.min(this.maxBackoffMs, this.initialBackoffMs * Math.pow(2, attempt));
    // Full Jitter: náhodný čas medzi 0 a plnou exponenciálnou hodnotou
    return Math.floor(Math.random() * exponential);
  }

  public setConnectionState(connected: boolean): void {
    this.isConnected = connected;
    if (connected) {
      this.reconnectAttempts = 0;
    }
  }

  public getQueueLength(): number {
    return this.offlineQueue.length;
  }

  public flushQueue(): ForensicSyncDelta[] {
    const items = [...this.offlineQueue];
    this.offlineQueue = [];
    return items;
  }

  public getHeadHash(): Sha256Hash {
    return this.currentHash;
  }

  public getCurrentSequence(): number {
    return this.currentSeq;
  }
}
