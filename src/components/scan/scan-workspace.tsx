"use client";

import { useState } from "react";
import { uploadToBucket } from "@/lib/bucket-upload";
import { postJson } from "@/lib/post-json";
import { MAX_BYTES, MAX_PAGES, ScanPicker } from "@/components/scan/scan-picker";
import { ScanResults } from "@/components/scan/scan-results";
import type { WorksheetGrading } from "@/lib/worksheets";

type Phase = "idle" | "uploading" | "marking" | "done";

/**
 * Photograph your worked page, have it marked.
 *
 * Two things are deliberately separated all the way through: what the model
 * *read* off the page, and whether that reading was *right*. A confident
 * misread would otherwise become a permanent wrong answer in the student's
 * history — so anything the model wasn't sure it transcribed correctly is held
 * back and shown for confirmation before it is recorded.
 *
 * This file is the lifecycle between the two screens it renders. The Supabase
 * browser client is imported at click time inside `uploadToBucket`, same as
 * everywhere else, so the auth SDK stays out of this route's initial bundle.
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

  return (
    <div className="space-y-10">
      {phase !== "done" && (
        <ScanPicker
          files={files}
          problemCount={problemCount}
          uploading={phase === "uploading"}
          marking={phase === "marking"}
          onAdd={addFiles}
          onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))}
          onSubmit={submit}
        />
      )}

      {error && (
        <p role="alert" className="aside-rule-bad">
          {error}
        </p>
      )}

      {grading && (
        <ScanResults grading={grading} confirming={confirming} onConfirm={confirm} />
      )}
    </div>
  );
}
