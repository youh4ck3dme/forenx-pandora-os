/**
 * 🛡️ PΛND0RΛ FORENSIC WEBSOCKET SYNCHRONIZATION ENGINE - TYPES & SCHEMAS
 * 
 * Nekompromisný typový systém s Branded Types, Zod runtime validáciou
 * a funkcionálnym Result<T, E> patternom.
 */

import { z } from "zod";

// ─── BRANDED / NOMINAL TYPES ─────────────────────────────────────
export type CaseId = string & { readonly __brand: unique symbol };
export type EvidenceId = string & { readonly __brand: unique symbol };
export type NodeId = string & { readonly __brand: unique symbol };
export type SequenceNumber = number & { readonly __brand: unique symbol };
export type Sha256Hash = string & { readonly __brand: unique symbol };

export function makeCaseId(id: string): CaseId {
  if (!id || id.trim().length === 0) throw new Error("Neplatné CaseId");
  return id as CaseId;
}

export function makeEvidenceId(id: string): EvidenceId {
  if (!id || id.trim().length === 0) throw new Error("Neplatné EvidenceId");
  return id as EvidenceId;
}

export function makeNodeId(id: string): NodeId {
  if (!id || id.trim().length === 0) throw new Error("Neplatné NodeId");
  return id as NodeId;
}

export function makeSequenceNumber(seq: number): SequenceNumber {
  if (!Number.isInteger(seq) || seq < 0) throw new Error("SequenceNumber musí byť nezáporné celé číslo");
  return seq as SequenceNumber;
}

export function makeSha256Hash(hash: string): Sha256Hash {
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error("Neplatný SHA-256 hash (očakáva sa 64 hex znakov)");
  return hash.toLowerCase() as Sha256Hash;
}

// ─── ZOD SCHEMAS ─────────────────────────────────────────────────
export const SyncDeltaSchema = z.object({
  type: z.literal("SYNC_DELTA"),
  caseId: z.string().min(1),
  evidenceId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  prevHash: z.string().regex(/^[a-f0-9]{64}$/i),
  currentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  payload: z.string(), // Base64 encoded payload chunk
  signature: z.string().min(1),
  timestamp: z.number().positive(),
});

export const HeartbeatSchema = z.object({
  type: z.literal("HEARTBEAT"),
  nodeId: z.string().min(1),
  timestamp: z.number().positive(),
});

export const AckSchema = z.object({
  type: z.literal("ACK"),
  ackSeq: z.number().int().nonnegative(),
  evidenceId: z.string().min(1),
  timestamp: z.number().positive(),
});

export const ForensicSyncFrameSchema = z.discriminatedUnion("type", [
  SyncDeltaSchema,
  HeartbeatSchema,
  AckSchema,
]);

// ─── DISCRIMINATED UNIONS ────────────────────────────────────────
export type ForensicSyncDelta = {
  readonly type: "SYNC_DELTA";
  readonly caseId: CaseId;
  readonly evidenceId: EvidenceId;
  readonly seq: SequenceNumber;
  readonly prevHash: Sha256Hash;
  readonly currentHash: Sha256Hash;
  readonly payload: string;
  readonly signature: string;
  readonly timestamp: number;
};

export type ForensicHeartbeat = {
  readonly type: "HEARTBEAT";
  readonly nodeId: NodeId;
  readonly timestamp: number;
};

export type ForensicAck = {
  readonly type: "ACK";
  readonly ackSeq: SequenceNumber;
  readonly evidenceId: EvidenceId;
  readonly timestamp: number;
};

export type ForensicSyncFrame = ForensicSyncDelta | ForensicHeartbeat | ForensicAck;

// ─── RESULT & ERROR PATTERN ──────────────────────────────────────
export type SyncError =
  | { readonly code: "HASH_MISMATCH"; readonly expected: Sha256Hash; readonly received: Sha256Hash }
  | { readonly code: "OUT_OF_SEQUENCE"; readonly expectedSeq: number; readonly receivedSeq: number }
  | { readonly code: "BACKPRESSURE_OVERFLOW"; readonly bufferedBytes: number; readonly limit: number }
  | { readonly code: "UNAUTHORIZED_SIGNATURE"; readonly evidenceId: EvidenceId }
  | { readonly code: "SCHEMA_VIOLATION"; readonly message: string }
  | { readonly code: "CONNECTION_CLOSED"; readonly reason: string };

export type SyncResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SyncError };

export const syncOk = <T>(value: T): SyncResult<T> => ({ ok: true, value });
export const syncErr = <T = never>(error: SyncError): SyncResult<T> => ({ ok: false, error });

// ─── AUDIT LOGGING SCHEMA ────────────────────────────────────────
export interface ForensicAuditLogEntry {
  readonly trace_id: string;
  readonly case_id?: string;
  readonly evidence_id?: string;
  readonly sequence_no?: number;
  readonly hash?: string;
  readonly client_ip: string;
  readonly action: string;
  readonly timestamp: string;
  readonly status: "VERIFIED" | "REJECTED" | "HEARTBEAT";
}
