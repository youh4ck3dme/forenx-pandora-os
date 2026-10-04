import { useCallback, useEffect, useId, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Camera, Loader2, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import {
  AVATAR_ACCEPT,
  cropAvatarToBlob,
  loadAvatarImageSrc,
  validateAvatarFile,
} from "@/lib/avatar-prep";

export type PendingAvatar = {
  blob: Blob;
  mime: "image/webp" | "image/jpeg";
  ext: "webp" | "jpg";
  previewUrl: string;
};

type AvatarEditorProps = {
  /** Uložená URL (cloud alebo data:). */
  savedUrl: string | null;
  pending: PendingAvatar | null;
  /** true = pri uložení profilu zmazať avatar. */
  markedForRemoval: boolean;
  onPendingChange: (pending: PendingAvatar | null) => void;
  onMarkedForRemovalChange: (value: boolean) => void;
  disabled?: boolean;
};

/**
 * Výber, orezanie (1:1 + zoom) a odstránenie fotky profilu.
 */
export function AvatarEditor({
  savedUrl,
  pending,
  markedForRemoval,
  onPendingChange,
  onMarkedForRemovalChange,
  disabled = false,
}: AvatarEditorProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [rawSrc, setRawSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const displayUrl = markedForRemoval
    ? null
    : (pending?.previewUrl ?? savedUrl);

  useEffect(() => {
    return () => {
      if (rawSrc?.startsWith("blob:")) URL.revokeObjectURL(rawSrc);
    };
  }, [rawSrc]);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  async function handleFileChange(file: File | undefined) {
    if (!file || disabled) return;
    const err = validateAvatarFile(file);
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      const src = await loadAvatarImageSrc(file);
      if (rawSrc?.startsWith("blob:")) URL.revokeObjectURL(rawSrc);
      setRawSrc(src);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setCropOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Fotku sa nepodarilo otvoriť.",
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleApplyCrop() {
    if (!rawSrc || !croppedAreaPixels) {
      toast.error("Najprv upravte výrez fotky.");
      return;
    }
    setBusy(true);
    try {
      const { blob, mime, ext } = await cropAvatarToBlob(
        rawSrc,
        croppedAreaPixels,
      );
      if (pending?.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(pending.previewUrl);
      }
      const previewUrl = URL.createObjectURL(blob);
      onPendingChange({ blob, mime, ext, previewUrl });
      onMarkedForRemovalChange(false);
      setCropOpen(false);
      if (rawSrc.startsWith("blob:")) URL.revokeObjectURL(rawSrc);
      setRawSrc(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Orezanie fotky zlyhalo.",
      );
    } finally {
      setBusy(false);
    }
  }

  function handleCloseCrop(open: boolean) {
    if (busy) return;
    setCropOpen(open);
    if (!open && rawSrc?.startsWith("blob:")) {
      URL.revokeObjectURL(rawSrc);
      setRawSrc(null);
    }
  }

  function handleRemove() {
    if (pending?.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(pending.previewUrl);
    }
    onPendingChange(null);
    if (savedUrl) onMarkedForRemovalChange(true);
  }

  const showRemove =
    Boolean(displayUrl) || Boolean(pending) || markedForRemoval;

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0">
        <Avatar className="h-16 w-16 rounded-xl border border-border">
          {displayUrl ? (
            <AvatarImage src={displayUrl} alt="Fotka profilu" />
          ) : null}
          <AvatarFallback className="rounded-xl bg-primary/10 text-primary">
            <UserCog className="h-6 w-6" aria-hidden />
          </AvatarFallback>
        </Avatar>
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/60">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          </span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium">Fotka profilu</p>
        <p className="text-[11px] text-muted-foreground">
          JPEG, PNG, WebP, GIF alebo HEIC — orežete ju na štvorec.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={AVATAR_ACCEPT}
            className="sr-only"
            disabled={disabled || busy}
            onChange={(e) => void handleFileChange(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            <Camera className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {displayUrl ? "Zmeniť fotku" : "Vybrať fotku"}
          </Button>
          {showRemove && !markedForRemoval ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-9 text-risk-high"
              disabled={disabled || busy}
              onClick={handleRemove}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Odstrániť
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={cropOpen} onOpenChange={handleCloseCrop}>
        <DialogContent className="max-w-md gap-4">
          <DialogHeader>
            <DialogTitle>Upraviť fotku</DialogTitle>
            <DialogDescription>
              Posuňte a priblížte výrez. Uloží sa štvorcová fotka.
            </DialogDescription>
          </DialogHeader>
          <div className="relative h-64 w-full overflow-hidden rounded-xl bg-muted text-foreground">
            {rawSrc ? (
              <Cropper
                image={rawSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            ) : null}
          </div>
          <div className="space-y-2">
            <label htmlFor={`${inputId}-zoom`} className="text-label">
              Priblíženie
            </label>
            <Slider
              id={`${inputId}-zoom`}
              min={1}
              max={3}
              step={0.05}
              value={[zoom]}
              onValueChange={(v) => setZoom(v[0] ?? 1)}
              disabled={busy}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => handleCloseCrop(false)}
            >
              Zrušiť
            </Button>
            <Button
              type="button"
              disabled={busy || !croppedAreaPixels}
              onClick={() => void handleApplyCrop()}
            >
              {busy ? "Ukladám…" : "Použiť výrez"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
