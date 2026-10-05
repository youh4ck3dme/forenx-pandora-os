# FORENX / PANDORA — SOURCE OF TRUTH

**Seal ID:** `PANDORA-SOT-2026-10-05-e1a7fba`
**Status:** SEALED HARDENING BASELINE
**Repository:** `youh4ck3dme/forenx-pandora-os`
**Branch:** `security/grok-forensic-hardening`
**Authoritative HEAD:** `e1a7fba07df7e4e0abf900ed16d9ce68cf3b0d8d`
**Seal date:** 2026-10-05
**Forensic AI provenance:** COMPLETE
**Court Pack provenance:** VERIFIED
**End-to-end Chain-of-Truth review:** VERIFIED / CLOSED
**Final reviewed repository HEAD:** `44388920b6c5e1d6a1e3f83b5d945d9a7d3b722b`

> This document is the normative status index for the sealed hardening baseline at the exact Git commit above. It does not replace source code. If this document and the code at the pinned commit disagree, the code, migrations and executable tests at the pinned commit win.

## 1. Source-of-truth precedence

For any dispute about current behavior, use this order:

1. Source code at exact commit `e1a7fba07df7e4e0abf900ed16d9ce68cf3b0d8d` on `security/grok-forensic-hardening`.
2. SQL migrations and database functions/triggers reachable from that commit.
3. Executable tests passing against that commit.
4. Runtime configuration required by the code.
5. This document as the authoritative status map.
6. Older audits, prompts, planning documents, README claims and chat transcripts.

No older report may override a verified invariant in this document without a new reproducible defect and a new commit.

## 2. Repository checkpoint

- Branch: `security/grok-forensic-hardening`
- Remote HEAD: `e1a7fba07df7e4e0abf900ed16d9ce68cf3b0d8d`
- HEAD message: `fix(court): bind AI provenance into signed pack`
- Parent: `6dae818e2b8b738378118dc80a4628e4262544d2`
- Remote/local equality was verified at the final checkpoint.
- GitHub currently reports the HEAD commit itself as **unsigned**. This is a repository-governance property and is separate from Court Pack cryptographic signing and RFC3161 verification.

## 3. Sealed commit chain

| Commit | Message | Normative effect |
|---|---|---|
| `00b5c87c81586f40eead6ae7280a0f9859705ddb` | `fix(security): harden forensic authorization and court verification` | Baseline hardening checkpoint: request-bound Court Pack access, authorization hardening and RFC3161 CMS timestamp binding in the offline verifier. |
| `006bda46e47c11a9212d04d9bf24821482d1c05a` | `fix(evidence): enforce case legal hold on deletion` | Case-level legal hold blocks evidence deletion through the audited path and table-owner bypass. |
| `5eb77341e43443cdab26c857a2111eec274a2a0a` | `fix(evidence): verify stored bytes before court export` | Court Pack re-hashes current storage bytes and fails closed on mismatch with the authoritative evidence SHA-256. |
| `928b63ed3b3e40239fb316209bcc4fd80d6c1055` | `fix(evidence): enforce authoritative object immutability` | Verified evidence objects cannot be overwritten or delete-and-recreated through supported application storage paths. |
| `e683a04ac24d0cd88ff6800fb906328f02dd9744` | `fix(forensics): bind AI runs to evidence input hashes` | Analysis run persists evidence SHA-256, derived-input SHA-256, prompt hash/version, provider/model and run identity. |
| `07433912fa8272f962a729bd7ed921cb214c7a20` | `fix(forensics): prevent provenance reassignment` | Client save cannot reassign authoritative evidence/run provenance to another evidence source. |
| `f4d07bcf19583a3b9539834a0dc0b1c9d9b340c2` | `fix(forensics): bind findings to analysis runs` | Authoritative finding payload is server-hashed and bound to its originating analysis run; post-run mutation is rejected. |
| `6dae818e2b8b738378118dc80a4628e4262544d2` | `fix(forensics): preserve analysis rerun lineage` | R1/F1 survives R2/F2 as immutable historical lineage with explicit current run and supersession relation. |
| `e1a7fba07df7e4e0abf900ed16d9ce68cf3b0d8d` | `fix(court): bind AI provenance into signed pack` | Court Pack signs provenance.json, verifies finding/evidence hashes before export, and prevents current/history, cross-run and cross-evidence mixing. |

## 4. Verified forensic/security invariants

| Boundary | Status | Evidence | Normative statement |
|---|---|---|---|
| Authorization / Court access baseline | **VERIFIED** | `00b5c87c` | Request-bound case loading and authorization hardening are part of the sealed baseline. |
| RFC3161 timestamp binding | **VERIFIED** | `00b5c87c` | Offline verifier binds the RFC3161 message imprint to the signed canonical manifest rather than merely accepting a non-empty token. |
| Evidence legal hold | **VERIFIED** | `006bda46` | Case-level legal hold fails closed for evidence deletion. |
| Audit hash-chain concurrency | **VERIFIED** | `No code change` | Database transaction advisory locking serializes predecessor selection; concurrent writers did not reproduce a fork. |
| Current evidence byte integrity at export | **VERIFIED** | `5eb77341` | Court Pack re-hashes current object bytes before signing/export. |
| Application-level evidence immutability | **VERIFIED** | `928b63ed` | Verified evidence cannot be overwritten or delete-and-recreated via supported app/service paths. |
| AI input provenance | **VERIFIED** | `e683a04a` | Evidence digest, derived-input digest, prompt hash/version, model/provider and analysis run ID are persisted with the run. |
| Cross-evidence provenance reassignment | **BLOCKED** | `07433912` | Client cannot replace authoritative evidence ID, evidence SHA-256, derived-input hash or run ID. |
| Finding integrity | **VERIFIED** | `f4d07bcf` | Authoritative finding hash is server-generated and bound to the originating run; full/partial mutation is blocked. |
| Rerun history / lineage | **VERIFIED** | `6dae818e` | Previous result remains reconstructable and immutable after a new run; current run and supersession are explicit. |
| Court Pack AI provenance | **VERIFIED** | `e1a7fba0` | Signed provenance.json binds finding, run, evidence, input, prompt and model metadata. |
| Offline provenance tamper detection | **VERIFIED** | `e1a7fba0` | Modifying provenance.json breaks signed manifest verification. |
| Forensic AI provenance | **COMPLETE** | `e1a7fba0` | End-to-end AI provenance from evidence digest to signed Court Pack is complete for the audited current-run export path. |

## 5. Current Chain of Truth

The audited current-run path is:

```text
SOURCE BYTES
   ↓
evidenceSha256
   ↓
DERIVED / EXTRACTED INPUT
   ↓
derivedInputSha256
   ↓
ANALYSIS RUN
   ├─ analysisRunId
   ├─ promptVersion
   ├─ promptSha256
   ├─ provider
   └─ model
   ↓
AUTHORITATIVE FINDING
   ↓
findingSha256
   ↓
RERUN LINEAGE
   ├─ immutable historical R1/F1 snapshot
   ├─ explicit current run
   └─ supersession relation
   ↓
COURT PACK provenance.json
   ↓
SIGNED MANIFEST
   ↓
SIGNATURE
   ↓
RFC3161 TIMESTAMP BINDING
   ↓
OFFLINE VERIFIER
```

### Export fail-close conditions

Court Pack generation must fail if any audited authoritative binding is inconsistent, including:

- current storage bytes do not match the authoritative evidence SHA-256;
- current finding payload does not recompute to the persisted finding SHA-256;
- finding and selected analysis run do not belong together;
- evidence/run provenance is mixed across evidence items;
- current and historical run/finding state is mixed;
- provenance.json is altered after manifest/signature creation.

## 6. Court Pack signed provenance contract

At the sealed HEAD, Court Pack uses a server-selected current authoritative run and includes signed provenance material covering the following audited fields where applicable:

- `analysisRunId`
- `findingSha256`
- `evidenceId`
- `evidenceSha256`
- `derivedInputSha256`
- `promptVersion`
- `promptSha256`
- `provider`
- `model`
- `supersedesRunId`
- generation timestamp / selected-run context

`provenance.json` is included in the signed manifest. A post-generation byte change to that file is detected by the offline verifier.

## 7. Rerun semantics

A new analysis run MUST NOT rewrite the historical identity of the previous result.

For a sequence:

```text
R1 → F1
R2 → F2
```

The sealed model guarantees:

- R1/F1 remains reconstructable after R2;
- R1 finding content/hash remains bound to R1;
- R2 receives a distinct run identity;
- R2 is explicitly current;
- the supersession relationship is persisted;
- historical lineage is not client-rewritable;
- same-input reruns remain distinct runs;
- changed-input reruns preserve distinct derived-input provenance.

## 8. Evidence storage trust boundary

### Guaranteed inside the application boundary

After `evidence_items.hash_verification_status = verified`:

- supported application upload paths cannot silently overwrite the authoritative object;
- supported application delete paths cannot delete and recreate the authoritative object under the same identity;
- presigned upload flow cannot target already-authoritative evidence;
- Court Pack independently re-hashes current bytes before export.

### Explicit non-guarantee

An infrastructure/storage administrator with direct object-store credentials can still mutate physical bytes outside the application trust boundary.

This baseline therefore claims:

**APPLICATION-LEVEL IMMUTABILITY + CRYPTOGRAPHIC TAMPER DETECTION**

It does **not** claim absolute storage-provider WORM against root/infrastructure administrators.

## 9. Audit hash-chain concurrency

The audited `case_audit_log` append boundary was tested with concurrent writers. The authoritative database path serializes predecessor selection at the database transaction layer (advisory transaction lock) and uses sequence uniqueness as an additional fail-closed constraint. No fork was reproduced in the audited concurrency tests.

This invariant does not rely on an in-process Node.js mutex.

## 10. Final verification gates

| Gate | Result |
|---|---|
| TypeScript typecheck | **PASS** |
| Court Pack tests | **PASS** |
| Court Pack provenance tests | **PASS** |
| AI provenance tests | **PASS** |
| Finding integrity tests | **PASS** |
| Rerun lineage tests | **PASS** |
| Evidence byte-integrity tests | **PASS** |
| Storage immutability tests | **PASS at 928b63ed checkpoint** |
| Legal-hold / evidence tests | **PASS at 006bda46 checkpoint** |
| Offline Court Pack verifier tests | **PASS** |
| git diff --check | **PASS** |

## 11. Claims allowed at this checkpoint

The following claims are supported by the sealed audited baseline:

- Authoritative evidence bytes are cryptographically identified with SHA-256.
- Verified evidence is application-level immutable through supported storage paths.
- Current evidence bytes are re-verified before Court Pack export.
- AI analysis runs retain exact evidence/input digest provenance.
- Prompt content/version and model/provider provenance are retained with the run.
- Authoritative findings are server-hashed and bound to their analysis run.
- Client saves cannot reassign authoritative provenance to a different evidence source.
- Historical analysis results survive reruns with explicit lineage.
- Court Pack binds the selected current finding/run/evidence provenance into signed `provenance.json`.
- Offline verification detects tampering of signed provenance material.
- **FORENSIC AI PROVENANCE COMPLETE: YES** for the audited current-run Court Pack path.

## 12. Claims NOT allowed

Do not state any of the following without additional independent evidence:

- “The evidence is automatically admissible in court.”
- “The system guarantees legal validity in every jurisdiction.”
- “Physical object storage is absolutely immutable against infrastructure/root administrators.”
- “Every Git commit is cryptographically signed.”
- “PANDORA Evidence Bundle `.pandora` v1, PANDORA Capture or PANDORA Witness are implemented and production-sealed.”

The `.pandora` Evidence Bundle / Capture / Witness work discussed separately remains a future protocol/product track unless and until implemented, tested and committed.

## 13. Final read-only review

Review type: READ-ONLY END-TO-END CHAIN-OF-TRUTH REVIEW

Repository HEAD reviewed: `44388920b6c5e1d6a1e3f83b5d945d9a7d3b722b`

Audited implementation checkpoint: `e1a7fba07df7e4e0abf900ed16d9ce68cf3b0d8d`

Result: PASS

New verified defect: NO

Source of Truth drift: NO

Worktree modified: NO

Chain of Truth: VERIFIED

Hardening closure: APPROVED

The reviewed chain was:

```text
SOURCE → HASH → DERIVED INPUT → RUN → FINDING → LINEAGE → COURT PACK → SIGNATURE → RFC3161 → OFFLINE VERIFY
```

This review did not change source code, tests, migrations or configuration.

## 14. Change-control rule

This document pins audited code commit `e1a7fba07df7e4e0abf900ed16d9ce68cf3b0d8d`.

Any later change to one of the following invalidates the seal and requires a new revision:

- evidence hashing or storage write/delete semantics;
- legal-hold behavior;
- audit-chain append logic;
- AI provenance metadata;
- finding canonicalization/hash contract;
- rerun lineage/history semantics;
- Court Pack provenance selection;
- manifest/signature/timestamp binding;
- offline verifier behavior.

Any future code change affecting evidence hashing, storage mutation semantics, legal hold, WORM, audit-chain append logic, AI input provenance, prompt provenance, finding hash contract, finding integrity, rerun lineage, Court Pack provenance, manifest signing, RFC3161 binding or offline verification invalidates inheritance of this audit status for the modified code.

Such a change requires new tests, a new review, a new audited code checkpoint and a new Source of Truth revision. The revision MUST name its exact branch, exact commit SHA and regression gates.

## 15. Canonical status

**SEALED HARDENING BASELINE:** `PANDORA-SOT-2026-10-05-e1a7fba`
**AUDITED CODE HEAD:** `e1a7fba07df7e4e0abf900ed16d9ce68cf3b0d8d`
**FINAL REVIEWED REPOSITORY HEAD:** `44388920b6c5e1d6a1e3f83b5d945d9a7d3b722b`
**FORENSIC AI PROVENANCE:** COMPLETE
**COURT PACK PROVENANCE:** VERIFIED
**SIGNED PROVENANCE COVERAGE:** VERIFIED
**RFC3161 BINDING:** VERIFIED
**OFFLINE VERIFIER:** VERIFIED
**CHAIN OF TRUTH END-TO-END:** VERIFIED
**FINAL READ-ONLY REVIEW:** PASS
**NEW VERIFIED DEFECT:** NO
**SOURCE OF TRUTH DRIFT:** NO
**HARDENING CHAPTER CLOSED:** YES
