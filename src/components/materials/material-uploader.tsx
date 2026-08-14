"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Sparkles, Upload, X } from "lucide-react";
import clsx from "clsx";
import { uploadToBucket } from "@/lib/bucket-upload";
import { postJson, RequestFailed } from "@/lib/post-json";
import {
  MAX_MATERIAL_FILE_BYTES,
  MAX_MATERIAL_FILES,
  MAX_MATERIAL_TOTAL_BYTES,
  MAX_PASTED_CHARS,
  MAX_WANT_CHARS,
} from "@/lib/material-limits";

/**
 * Turn a worksheet, a chapter or a page of notes into something practice can be
 * built from.
 *
 * Files go straight to storage from the browser, the same way scans do — it is
 * what keeps megabytes out of the serverless request body, and the storage
 * policy's `${userId}/...` prefix is what authorizes the write. The route is
 * then told only which paths to read.
 *
 * The caps come from `material-limits.ts` rather than `lib/materials.ts`, which
 * cannot be imported here: that module pulls in the service client, and a
 * client component importing it would ship the service client to the browser.
 * They were hand-copied for that reason and one copy had already drifted. What
 * is checked here is a courtesy either way — the bucket's `file_size_limit` and
 * the reader's own cap are what actually hold.
 */
const ACCEPTED = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

/** So the copy quotes the cap rather than a number that used to match it. */
const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

type Phase = "idle" | "uploading" | "reading";

export function MaterialUploader() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [want, setWant] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle";
  const hasMaterial = files.length > 0 || text.trim().length > 0;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const picked = Array.from(list);
    const tooBig = picked.find((f) => f.size > MAX_MATERIAL_FILE_BYTES);
    if (tooBig) {
      setError(
        `"${tooBig.name}" is over ${mb(MAX_MATERIAL_FILE_BYTES)} MB. A photo from a phone is usually well under.`
      );
      return;
    }
    const room = MAX_MATERIAL_FILES - files.length;
    if (picked.length > room) {
      setError(`Up to ${MAX_MATERIAL_FILES} files at a time — the rest weren't added.`);
    }
    const next = [...files, ...picked].slice(0, MAX_MATERIAL_FILES);
    // Four files at the per-file cap are double what the reader will take, and
    // it stops at the total rather than failing — so the pages past it are
    // simply absent from the digest, which from here looks like the model
    // ignoring a page. This is the only point where that can be said out loud.
    if (next.reduce((sum, f) => sum + f.size, 0) > MAX_MATERIAL_TOTAL_BYTES) {
      setError(
        `That's over ${mb(MAX_MATERIAL_TOTAL_BYTES)} MB altogether, and we'd have to stop reading part way. Remove a page, or send the rest as a second upload.`
      );
      return;
    }
    setFiles(next);
  }

  async function submit() {
    setError(null);
    setPhase("uploading");
    try {
      const paths = await uploadToBucket("study-materials", files);

      setPhase("reading");
      const { materialId } = await postJson<{ materialId: string }>(
        "/api/materials",
        { paths, text: text.trim(), want: want.trim() },
        "Couldn't read that one."
      );
      router.push(`/materials/${materialId}`);
      // Left busy through the navigation, so nothing can be submitted twice.
    } catch (e) {
      /**
       * A rejection is still a material, and it is the one failure that has
       * somewhere to go: the server hands back the id of the row it declined,
       * whose own page explains the verdict in our words. Without this the row
       * was written, listed nowhere (the index shows only `ready`), and
       * reachable only by typing the URL.
       *
       * Every other failure has no id and stays on the form.
       */
      if (e instanceof RequestFailed && typeof e.body.materialId === "string") {
        router.push(`/materials/${e.body.materialId}`);
        return;
      }
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-9">
      <section>
        <label
          className={clsx("dropzone", busy && "dropzone-busy")}
        >
          <Upload className="h-5 w-5 text-faint" aria-hidden />
          <span className="text-sm text-muted">
            {files.length === 0
              ? "Photograph a worksheet, or choose a PDF"
              : `${files.length} file${files.length === 1 ? "" : "s"} ready`}
          </span>
          <span className="mono-meta">
            Up to {MAX_MATERIAL_FILES} files · photos or PDF · {mb(MAX_MATERIAL_FILE_BYTES)} MB each
            · {mb(MAX_MATERIAL_TOTAL_BYTES)} MB in total
          </span>
          <input
            type="file"
            accept={ACCEPTED}
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(e) => addFiles(e.target.files)}
          />
        </label>

        {files.length > 0 && (
          <ul className="mt-4 space-y-2">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center gap-3 rounded-sm border border-line px-3 py-2.5"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="btn btn-ghost btn-icon"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <label htmlFor="material-text" className="eyebrow block">
          Or paste it
        </label>
        <textarea
          id="material-text"
          value={text}
          disabled={busy}
          maxLength={MAX_PASTED_CHARS}
          rows={6}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the problems, the worked examples, or your notes."
          // `sm:` on the size, so a phone keeps the 16px that stops iOS
          // zooming the viewport the moment this is tapped.
          className="field resize-y font-mono sm:text-sm"
        />
        <p className="mono-meta">Works on its own, or alongside the files above.</p>
      </section>

      <section className="space-y-2">
        <label htmlFor="material-want" className="eyebrow block">
          What do you want? <span className="text-faint">(optional)</span>
        </label>
        <textarea
          id="material-want"
          value={want}
          disabled={busy}
          maxLength={MAX_WANT_CHARS}
          rows={2}
          onChange={(e) => setWant(e.target.value)}
          placeholder="e.g. more of the same, but harder — or word problems instead of drills"
          className="field resize-y"
        />
        <p className="mono-meta">
          {want.length > 0 ? `${want.length}/${MAX_WANT_CHARS} · ` : ""}Leave it blank and we&apos;ll go
          off the material alone.
        </p>
      </section>

      {error && (
        <p role="alert" className="aside-rule-bad">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="button"
          disabled={!hasMaterial || busy}
          onClick={submit}
          className="btn btn-accent btn-lg"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          {phase === "uploading" ? "Uploading…" : phase === "reading" ? "Reading…" : "Read my material"}
        </button>
        {!busy && !hasMaterial && (
          <span className="text-sm text-faint">Add a file or paste something first.</span>
        )}
        {phase === "reading" && (
          <span aria-live="polite" className="text-sm text-muted">
            This takes about half a minute.
          </span>
        )}
      </div>
    </div>
  );
}
