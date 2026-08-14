"use client";

import clsx from "clsx";
import { Camera, Loader2, Upload, X } from "lucide-react";

/** Kept in step with the storage policy's `${userId}/...` prefix.
 *  `heif` alongside `heic`: iOS reports some camera captures as the former,
 *  and a picker that greys the photo out is indistinguishable from a bug. */
const ACCEPTED = "image/jpeg,image/png,image/webp,image/heic,image/heif";
export const MAX_PAGES = 8;
export const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Choosing the pages and handing them over.
 *
 * Phase `"done"` hides this entirely, so it and the results never coexist on
 * screen — which is why they are separate components rather than two halves of
 * one render.
 */
export function ScanPicker({
  files,
  problemCount,
  uploading,
  marking,
  onAdd,
  onRemove,
  onSubmit,
}: {
  files: File[];
  problemCount: number;
  /** The two working states, which the button label is the only report of. */
  uploading: boolean;
  marking: boolean;
  onAdd: (list: FileList | null) => void;
  onRemove: (index: number) => void;
  onSubmit: () => void;
}) {
  const busy = uploading || marking;

  return (
    <section>
      {/* Two controls, not one.
          `capture` and `multiple` on the same input contradict each other,
          and the browser resolves it by opening the camera and hiding the
          photo library — so a student who had already photographed the
          page, which is the likeliest way this gets used, could not submit
          it, and "up to 8 pages" meant eight trips through the camera. The
          materials uploader never had `capture` and was right; here the
          camera is worth keeping as its own button. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={clsx("dropzone", busy && "dropzone-busy")}>
          <Camera className="h-5 w-5 text-faint" aria-hidden />
          <span className="text-sm text-muted">Take a photo</span>
          <span className="mono-meta">one page at a time</span>
          <input
            type="file"
            accept={ACCEPTED}
            capture="environment"
            disabled={busy}
            className="sr-only"
            onChange={(e) => onAdd(e.target.files)}
          />
        </label>

        <label className={clsx("dropzone", busy && "dropzone-busy")}>
          <Upload className="h-5 w-5 text-faint" aria-hidden />
          <span className="text-sm text-muted">Choose photos</span>
          <span className="mono-meta">from your library or files</span>
          <input
            type="file"
            accept={ACCEPTED}
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(e) => onAdd(e.target.files)}
          />
        </label>
      </div>

      <p className="mono-meta mt-3 text-center">
        {files.length === 0
          ? `Up to ${MAX_PAGES} pages · this set has ${problemCount} problems`
          : `${files.length} page${files.length === 1 ? "" : "s"} ready · up to ${MAX_PAGES}`}
      </p>

      {files.length > 0 && (
        <ul className="mt-4 space-y-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-3 rounded-sm border border-line px-3 py-2.5"
            >
              <span className="mono-meta w-6">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove ${f.name}`}
                onClick={() => onRemove(i)}
                className="btn btn-ghost btn-icon"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-7 flex flex-wrap items-center gap-4">
        <button
          type="button"
          disabled={files.length === 0 || busy}
          onClick={onSubmit}
          className="btn btn-accent btn-lg"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {uploading ? "Uploading…" : marking ? "Marking…" : "Mark my work"}
        </button>
        {marking && (
          <p className="mono-meta">Reading the pages — this takes a moment.</p>
        )}
      </div>
    </section>
  );
}
