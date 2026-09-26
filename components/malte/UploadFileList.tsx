import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  X,
} from "lucide-react";

export type UploadFileStatus = "queued" | "reading" | "done" | "failed";

export type UploadFileItem = {
  name: string;
  status: UploadFileStatus;
  chars?: number | undefined;
  size?: number | undefined;
  pages?: number | undefined;
  usedOcr?: boolean | undefined;
  error?: string | undefined;
  pdfHeaderOk?: boolean | undefined;
};

/** Krátky stav v slovenčine: čaká / beží / hotovo / chyba. */
export function statusLabel(status: UploadFileStatus): string {
  if (status === "queued") return "čaká";
  if (status === "reading") return "beží";
  if (status === "done") return "hotovo";
  return "chyba";
}

function detail(file: UploadFileItem): string {
  const pages =
    typeof file.pages === "number" ? `${file.pages} str.` : undefined;
  if (file.status === "failed") {
    return file.error ?? "Súbor sa nepodarilo čítať.";
  }
  if (file.status === "queued") {
    return [pages, "čaká v poradí"].filter(Boolean).join(" • ");
  }
  if (file.status === "reading") {
    return [pages, "beží — AI číta dokument"].filter(Boolean).join(" • ");
  }
  const parts: string[] = [];
  if (pages) parts.push(pages);
  if (typeof file.chars === "number") parts.push(`${file.chars} znakov`);
  if (typeof file.size === "number")
    parts.push(`${Math.max(1, Math.round(file.size / 1024))} kB`);
  if (file.usedOcr) parts.push("prečítané cez OCR");
  if (file.pdfHeaderOk === false) parts.push("hlavička PDF nesedí");
  return parts.join(" • ") || "Hotovo";
}

/** Spoločný zoznam nahratých súborov so stavom spracovania. */
export function UploadFileList({
  files,
  onRemove,
}: {
  files: UploadFileItem[];
  onRemove?: (name: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <ul className="space-y-2">
      {files.map((file) => (
        <li key={file.name} className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">
            {file.status === "done" ? (
              <CheckCircle2 className="h-4 w-4 text-risk-low" aria-hidden />
            ) : file.status === "failed" ? (
              <AlertTriangle className="h-4 w-4 text-risk-high" aria-hidden />
            ) : file.status === "reading" ? (
              <Loader2
                className="h-4 w-4 animate-spin text-primary"
                aria-hidden
              />
            ) : (
              <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {file.name}
              </span>
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {statusLabel(file.status)}
              </span>
            </span>
            <span className="block text-[11px] text-muted-foreground">
              {detail(file)}
            </span>
          </span>
          {onRemove ? (
            <button
              type="button"
              aria-label={`Odstrániť ${file.name}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => onRemove(file.name)}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
