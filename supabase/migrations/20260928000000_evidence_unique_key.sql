-- P0-03: transactional persistence of post-upload evidence records.
--
-- A unique index on s3_object_key closes the last race in the commit path:
-- two concurrent POST /api/vault/commit calls for the same S3 object could
-- both pass findByKey(null) and insert two ledger rows. With the unique
-- index the second insert fails atomically inside the same transaction as
-- the audit trigger, and registerEvidence() falls back to the existing row
-- (idempotent under concurrency).

create unique index if not exists evidence_items_s3_object_key_uidx
  on public.evidence_items (s3_object_key);

comment on index public.evidence_items_s3_object_key_uidx is
  'P0-03: idempotent evidence registration — one ledger row per S3 object';
