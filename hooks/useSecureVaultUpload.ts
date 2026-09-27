import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface VaultUploadResult {
  success: boolean;
  message?: string;
  evidenceId?: string;
}

export function useSecureVaultUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Vypočíta SHA-256 hash súboru priamo v prehliadači pomocou WebCrypto API
  const calculateSHA256 = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hashHex;
  };

  const uploadEvidence = async (
    file: File,
    caseName: string,
  ): Promise<VaultUploadResult> => {
    setIsUploading(true);
    setProgress(0);

    try {
      // 1. Vypočítaj klientský Hash (Chain of Custody záchrana)
      setProgress(10);
      const sha256Hash = await calculateSHA256(file);
      setProgress(25);

      // 2. Požiadaj o Predpodpísanú URL (S3 Presigned URL)
      const presignRes = await fetch("/api/vault/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
          sha256Hash: sha256Hash, // Odovzdávame hash na audit na serveri
        }),
      });

      if (!presignRes.ok) {
        throw new Error("Nepodarilo sa získať presigned URL pre S3 ukladanie.");
      }

      const { url, objectKey } = await presignRes.json();
      setProgress(40);

      // 3. Nahraj súbor PRIAMO do S3 (Direct Upload bez zaťaženia Vercel Edge limitov)
      const uploadRes = await fetch(url, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type,
        },
      });

      if (!uploadRes.ok) {
        throw new Error("Chyba pri nahrávaní priamo do S3 Vaultu.");
      }
      setProgress(80);

      // 4. Zapíš metadáta do The Evidence Ledger v Supabase
      const { data: userData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !userData?.user)
        throw new Error("Nepodarilo sa overiť identitu.");

      const { data: evidenceRecord, error: dbErr } = await supabase
        .from("evidence_items")
        .insert({
          investigator_id: userData.user.id,
          case_name: caseName,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          s3_object_key: objectKey,
          sha256_hash: sha256Hash,
          legal_hold: false, // Dôkaz je odteraz upraviteľný/zmazateľný iba ak toto je false
        })
        .select()
        .single();

      if (dbErr) throw dbErr;

      setProgress(100);
      return { success: true, evidenceId: evidenceRecord.id };
    } catch (error: any) {
      console.error("Vault Upload Error:", error);
      return {
        success: false,
        message: error.message || "Neznáma chyba pri uploade",
      };
    } finally {
      setIsUploading(false);
    }
  };

  return { uploadEvidence, isUploading, progress };
}
