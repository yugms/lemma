import { createServiceClient } from "@/lib/supabase/service";
import type { ScanMark } from "@/lib/ai/grade-scan";

/**
 * Photographed worksheets: the upload record, and the grading attached to it.
 *
 * Uploads land in the private `worksheet-scans` bucket under the owner's id,
 * which is what the storage policies key on. Everything here runs server-side
 * with the service client: the row's `status` and `grading` are written after
 * marking, and a client that could write them could mark its own work.
 */

export const SCAN_BUCKET = "worksheet-scans";

export type ScanStatus = "pending" | "graded" | "failed";

export type WorksheetGrading = {
  marks: ScanMark[];
  page_note: string | null;
  /** Problem positions whose reading was too uncertain to record unconfirmed. */
  needs_confirmation: number[];
  /** Positions actually written to `attempts`. */
  recorded: number[];
};

export type WorksheetUpload = {
  id: string;
  set_id: string;
  status: ScanStatus;
  storage_paths: string[];
  grading: WorksheetGrading | null;
  created_at: string;
};

/** Where one page of one upload lives. Prefixed by owner, per the RLS policy. */
export function scanPath(userId: string, uploadId: string, index: number, ext: string): string {
  return `${userId}/${uploadId}/${index}.${ext}`;
}

export async function createUpload(
  userId: string,
  setId: string,
  storagePaths: string[]
): Promise<string | null> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("worksheet_uploads")
    .insert({ user_id: userId, set_id: setId, storage_paths: storagePaths, status: "pending" })
    .select("id")
    .single();
  return error ? null : (data.id as string);
}

export async function finishUpload(
  uploadId: string,
  status: ScanStatus,
  grading: WorksheetGrading | null
): Promise<void> {
  const db = createServiceClient();
  await db
    .from("worksheet_uploads")
    .update({ status, grading: grading as never })
    .eq("id", uploadId);
}

/** Download the stored pages as base64, for the vision call. */
export async function loadScanImages(
  paths: string[]
): Promise<{ mimeType: string; data: string }[]> {
  const db = createServiceClient();
  const out: { mimeType: string; data: string }[] = [];
  for (const path of paths) {
    const { data, error } = await db.storage.from(SCAN_BUCKET).download(path);
    if (error || !data) continue;
    const buffer = Buffer.from(await data.arrayBuffer());
    out.push({
      mimeType: data.type || "image/jpeg",
      data: buffer.toString("base64"),
    });
  }
  return out;
}

/** The most recent upload for a set, scoped to its owner. */
export async function latestUpload(
  userId: string,
  setId: string
): Promise<WorksheetUpload | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("worksheet_uploads")
    .select("id, set_id, status, storage_paths, grading, created_at")
    .eq("user_id", userId)
    .eq("set_id", setId)
    .order("created_at", { ascending: false })
    .limit(1);
  return (data?.[0] as WorksheetUpload | undefined) ?? null;
}

export async function getUpload(
  userId: string,
  uploadId: string
): Promise<WorksheetUpload | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("worksheet_uploads")
    .select("id, set_id, status, storage_paths, grading, created_at")
    .eq("user_id", userId)
    .eq("id", uploadId)
    .limit(1);
  return (data?.[0] as WorksheetUpload | undefined) ?? null;
}

/**
 * Record confidently-read marks as attempts.
 *
 * Rows are inserted one at a time rather than as a batch because
 * `attempts_one_per_attempt` makes a duplicate expected, not exceptional: the
 * student may have already typed some of these problems in. A batch insert
 * would lose every mark to one collision, so a conflict skips that problem and
 * leaves the earlier outcome standing — what they did first is the record.
 */
export async function recordScanAttempts(
  userId: string,
  setId: string,
  marks: { mark: ScanMark; problemId: string }[]
): Promise<number[]> {
  const db = createServiceClient();
  const recorded: number[] = [];
  for (const { mark, problemId } of marks) {
    const { error } = await db.from("attempts").insert({
      user_id: userId,
      set_id: setId,
      problem_id: problemId,
      mode: "scan",
      answer: mark.read_answer as never,
      is_correct: mark.correct,
      ai_feedback: mark.correct ? null : ({ scan_note: mark.note } as never),
      time_ms: null,
    });
    if (!error) recorded.push(mark.problem_number);
  }
  return recorded;
}
