interface Window {
  forenxDesktop?: {
    openExternalSafely(url: string): Promise<{ ok: boolean; code?: string }>;
    selectEvidenceFiles(caseId: string): Promise<unknown>;
    readEvidenceChunk(
      tokenId: string,
      offset: number,
      length: number,
    ): Promise<unknown>;
  };
}
