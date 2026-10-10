export type AssetTimelineMetadataState = "queued" | "running" | "completed" | "failed" | "cancelled";
export type AssetTimelineMetadataAction = "reuse" | "reset" | "invalid";

export function decideAssetTimelineMetadataAction(status: string): AssetTimelineMetadataAction {
  if (status === "queued" || status === "running") return "reuse";
  if (status === "failed" || status === "cancelled") return "reset";
  if (status === "completed") return "invalid";
  return "invalid";
}

export function nextAssetTimelineAttempt(attemptCount: unknown): number {
  const current = Number(attemptCount ?? 0);
  return Number.isFinite(current) && current >= 0 ? Math.floor(current) + 1 : 1;
}
