"use client";

import { useState } from "react";
import clsx from "clsx";
import { Camera, Check, HelpCircle, Loader2, Minus, Upload, X } from "lucide-react";
import { uploadToBucket } from "@/lib/bucket-upload";
import { postJson } from "@/lib/post-json";
import { wasAttempted } from "@/lib/scan-marks";
import type { ScanMark } from "@/lib/ai/grade-scan";
import type { WorksheetGrading } from "@/lib/worksheets";

/** Kept in step with the storage policy's `${userId}/...` prefix.
 *  `heif` alongside `heic`: iOS reports some camera captures as the former,
 *  and a picker that greys the photo out is indistinguishable from a bug. */
const ACCEPTED = "image/jpeg,image/png,image/webp,image/heic,image/heif";
const MAX_PAGES = 8;
const MAX_BYTES = 8 * 1024 * 1024;

type Phase = "idle" | "uploading" | "marking" | "done";

/**
 * Photograph your worked page, have it marked.
 *
 * Two things are deliberately separated all the way through: what the model
 * *read* off the page, and whether that reading was *right*. A confident
 * misread would otherwise become a permanent wrong answer in the student's
 * history — so anything the model wasn't sure it transcribed correctly is held
 * back and shown here for confirmation before it is recorded.
 *
 * The Supabase browser client is imported at click time, same as everywhere
 * else, so the auth SDK stays out of this route's initial bundle.
 */
export function ScanWorkspace({
  setId,
  problemCount,
  initialGrading,
  initialUploadId,
}: {
  setId: string;
  problemCount: number;
  initialGrading: WorksheetGrading | null;
  initialUploadId: string | null;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>(initialGrading ? "done" : "idle");
  const [grading, setGrading] = useState<WorksheetGrading | null>(initialGrading);
  const [uploadId, setUploadId] = useState<string | null>(initialUploadId);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const busy = phase === "uploading" || phase === "marking";

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const picked = Array.from(list);
    const tooBig = picked.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      setError(`"${tooBig.name}" is over 8 MB. Photos from a phone are usually fine.`);
      return;
    }
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_PAGES));
  }

  async function submit() {
    if (files.length === 0) return;
    setPhase("uploading");
    setError(null);
    try {
      const paths = await uploadToBucket("worksheet-scans", files, "jpg");

      setPhase("marking");
      const json = await postJson<{ grading: WorksheetGrading; uploadId: string }>(
        "/api/scan",
        { setId, paths },
        "That work couldn't be marked."
      );
      setGrading(json.grading);
      setUploadId(json.uploadId);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
      setPhase("idle");
    }
  }

  async function confirm(positions: number[]) {
    if (!uploadId || positions.length === 0) return;
    setConfirming(true);
    setError(null);
    try {
      const json = await postJson<{ grading: WorksheetGrading }>(
        "/api/scan",
        { action: "confirm", uploadId, positions },
        "Couldn't record that."
      );
      setGrading(json.grading);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't record that — try again.");
    } finally {
      setConfirming(false);
    }
  }

  const marks = grading?.marks ?? [];
  const pending = new Set(grading?.needs_confirmation ?? []);
  // Scored out of what was actually attempted. Counting blanks against the
  // student would report "3/6" for a page they only got three-quarters through.
  const answered = marks.filter(wasAttempted);
  const right = answered.filter((m) => m.correct).length;

  return (
    <div className="space-y-10">
      {phase !== "done" && (
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
            <label
              className={clsx("dropzone", busy && "dropzone-busy")}
            >
              <Camera className="h-5 w-5 text-faint" aria-hidden />
              <span className="text-sm text-muted">Take a photo</span>
              <span className="mono-meta">one page at a time</span>
              <input
                type="file"
                accept={ACCEPTED}
                capture="environment"
                disabled={busy}
                className="sr-only"
                onChange={(e) => addFiles(e.target.files)}
              />
            </label>

            <label
              className={clsx("dropzone", busy && "dropzone-busy")}
            >
              <Upload className="h-5 w-5 text-faint" aria-hidden />
              <span className="text-sm text-muted">Choose photos</span>
              <span className="mono-meta">from your library or files</span>
              <input
                type="file"
                accept={ACCEPTED}
                multiple
                disabled={busy}
                className="sr-only"
                onChange={(e) => addFiles(e.target.files)}
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
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
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
              onClick={submit}
              className="btn btn-accent btn-lg"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {phase === "uploading"
                ? "Uploading…"
                : phase === "marking"
                  ? "Marking…"
                  : "Mark my work"}
            </button>
            {phase === "marking" && (
              <p className="mono-meta">Reading the pages — this takes a moment.</p>
            )}
          </div>
        </section>
      )}

      {error && (
        <p role="alert" className="aside-rule-bad">
          {error}
        </p>
      )}

      {grading && (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
            <h2 className="eyebrow">Marked</h2>
            <p className="mono-meta">
              {right}/{answered.length} correct
              {marks.length > answered.length &&
                ` · ${marks.length - answered.length} not attempted`}
              {grading.recorded.length > 0 && ` · ${grading.recorded.length} recorded`}
            </p>
          </div>

          {grading.page_note && (
            <p className="aside-rule mt-5 border-line-strong py-1 text-sm leading-relaxed text-muted">
              {grading.page_note}
            </p>
          )}

          {pending.size > 0 && (
            <div className="panel mt-6 px-5 py-5">
              <p className="flex items-center gap-2 text-sm font-medium">
                <HelpCircle className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                Check these readings first
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                The handwriting here was hard to make out. Nothing below is on your record
                yet — confirm the reading is right and it counts, or leave it and it
                won&apos;t.
              </p>
              <button
                type="button"
                disabled={confirming}
                onClick={() => confirm([...pending])}
                className="btn btn-outline btn-sm mt-5"
              >
                {confirming && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                Yes, that&apos;s what I wrote
              </button>
            </div>
          )}

          <ul className="mt-6 space-y-5">
            {marks.map((m) => (
              <MarkRow key={m.problem_number} mark={m} pending={pending.has(m.problem_number)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function MarkRow({ mark, pending }: { mark: ScanMark; pending: boolean }) {
  // Three outcomes, not two: correct, incorrect, and never answered. The third
  // is deliberately not styled as a miss — the student didn't get it wrong.
  const attempted = wasAttempted(mark);

  return (
    <li className="flex gap-4">
      <span
        aria-hidden
        className={clsx(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
          !attempted && "bg-sunk text-faint",
          attempted && mark.correct && "bg-ok-wash text-ok",
          attempted && !mark.correct && "bg-bad-wash text-bad"
        )}
      >
        {!attempted ? (
          <Minus className="h-3 w-3" aria-hidden />
        ) : mark.correct ? (
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
        ) : (
          <X className="h-3 w-3" strokeWidth={3} aria-hidden />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="mono-meta flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>problem {mark.problem_number}</span>
          {/* Never colour alone — the word carries it with the icon. */}
          {!attempted ? (
            <span>not answered · not recorded</span>
          ) : (
            <span className={mark.correct ? "text-ok" : "text-bad"}>
              {mark.correct ? "correct" : "incorrect"}
            </span>
          )}
          {pending && <span className="text-muted">awaiting your confirmation</span>}
        </p>
        {attempted && (
          <p className="mt-2 text-[15px] leading-7">
            <span className="text-faint">Read as</span>{" "}
            <span className="font-mono">{mark.read_answer}</span>
          </p>
        )}
        {mark.note && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{mark.note}</p>
        )}
      </div>
    </li>
  );
}
