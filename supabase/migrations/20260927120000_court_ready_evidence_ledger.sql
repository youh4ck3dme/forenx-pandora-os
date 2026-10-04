-- Krok 1: Vytvorenie the Evidence Ledger
-- Účel: Zabezpečiť bezpečné uchovávanie metadát a hashov o dôkazoch.

CREATE TABLE public.evidence_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigator_id UUID NOT NULL REFERENCES auth.users(id),
    case_name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type TEXT NOT NULL,
    s3_object_key TEXT NOT NULL,
    sha256_hash TEXT NOT NULL,
    legal_hold BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Zapnutie RLS (Row Level Security)
ALTER TABLE public.evidence_items ENABLE ROW LEVEL SECURITY;

-- 1. Insert: investigators can only insert for themselves
CREATE POLICY "Investigators can insert evidence"
ON public.evidence_items
FOR INSERT
WITH CHECK (auth.uid() = investigator_id);

-- 2. Select: investigators can view their own evidence
CREATE POLICY "Investigators can view own evidence"
ON public.evidence_items
FOR SELECT
USING (auth.uid() = investigator_id);

-- 3. Update: Nobody can update if legal_hold is true
CREATE POLICY "Allow update if no legal hold"
ON public.evidence_items
FOR UPDATE
USING (auth.uid() = investigator_id AND legal_hold = false)
WITH CHECK (auth.uid() = investigator_id AND legal_hold = false);

-- 4. Delete: Nobody can delete if legal_hold is true
CREATE POLICY "Allow delete if no legal hold"
ON public.evidence_items
FOR DELETE
USING (auth.uid() = investigator_id AND legal_hold = false);

-- Automatická aktualizácia updated_at
CREATE OR REPLACE FUNCTION update_evidence_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_items_updated_at
BEFORE UPDATE ON public.evidence_items
FOR EACH ROW
EXECUTE FUNCTION update_evidence_updated_at();
