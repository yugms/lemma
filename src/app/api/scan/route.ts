import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { gradeScan, SCAN_CONFIDENCE_THRESHOLD, type ScanProblem } from "@/lib/ai/grade-scan";
import {
  createUpload,
  finishUpload,
  getUpload,
  loadScanImages,
  recordScanAttempts,
  type WorksheetGrading,
} from "@/lib/worksheets";
import type { ProblemAnswerRecord, ProblemContentRecord } from "@/lib/ai/schemas";

export const runtime = "nodejs";
// Vision over several pages, then one insert per marked problem. Well short of
// a set build, but far past the default.
export const maxDuration = 300;

const GradeSchema = z.object({
  action: z.literal("grade").optional(),
  setId: z.string().uuid(),
  /** Storage paths already uploaded by the browser under the caller's prefix. */
  paths: z.array(z.string().min(1)).min(1).max(8),
});

/** Accept the model's reading of a problem it was unsure it had read right. */
const ConfirmSchema = z.object({
  action: z.literal("confirm"),
  uploadId: z.string().uuid(),
  /** Problem positions the student agrees were transcribed correctly. */
  positions: z.array(z.number().int().min(1)).min(1).max(50),
});

const BodySchema = z.union([ConfirmSchema, GradeSchema]);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = createServiceClient();

  if (body.action === "confirm") {
    return confirmReadings(user.id, body.uploadId, body.positions);
  }

  // The set's answer key is about to be read, so prove the caller owns it. RLS
  // would cover the read below, but this route uses the service client to write
  // attempts, so the check has to be explicit — the same reason /api/check
  // verifies ownership rather than trusting the set id.
  const { data: owned } = await db
    .from("problem_sets")
    .select("id")
    .eq("id", body.setId)
    .eq("owner_id", user.id)
    .limit(1);
  if (!owned || owned.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Paths are supplied by the client, so confirm each one sits under this
  // user's own prefix. Without this a caller could name someone else's upload
  // and have it transcribed back to them.
  if (!body.paths.every((p) => p.startsWith(`${user.id}/`))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { data: items } = await db
    .from("problem_set_items")
    .select("position, problems!inner(id, content, answer)")
    .eq("set_id", body.setId)
    .order("position");

  const problems: ScanProblem[] = ((items ?? []) as unknown as {
    position: number;
    problems: { id: string; content: ProblemContentRecord; answer: ProblemAnswerRecord } | null;
  }[])
    .filter((i) => i.problems)
    .map((i) => ({
      id: i.problems!.id,
      position: i.position,
      content: i.problems!.content,
      answer: i.problems!.answer,
    }));

  if (problems.length === 0) {
    return Response.json({ error: "That set has no problems." }, { status: 400 });
  }

  const uploadId = await createUpload(user.id, body.setId, body.paths);
  if (!uploadId) {
    return Response.json({ error: "Couldn't start that upload — try again." }, { status: 503 });
  }

  const images = await loadScanImages(body.paths);
  if (images.length === 0) {
    await finishUpload(uploadId, "failed", null);
    return Response.json({ error: "Those pages couldn't be read back." }, { status: 400 });
  }

  let result;
  try {
    result = await gradeScan(problems, images);
  } catch {
    // The provider throws only when every model was rate-limited or overloaded,
    // which is worth telling the student to retry rather than recording as a
    // page full of wrong answers.
    await finishUpload(uploadId, "failed", null);
    return Response.json(
      { error: "The marking service is busy — try again in a minute." },
      { status: 503 }
    );
  }
  if (!result) {
    await finishUpload(uploadId, "failed", null);
    return Response.json({ error: "That work couldn't be marked." }, { status: 502 });
  }

  const byPosition = new Map(problems.map((p) => [p.position, p]));
  // A mark for a problem that isn't in the set is a hallucinated page number.
  const marks = result.marks.filter((m) => byPosition.has(m.problem_number));

  const confident = marks.filter(
    (m) => m.found && m.confidence >= SCAN_CONFIDENCE_THRESHOLD
  );
  const uncertain = marks.filter((m) => m.found && m.confidence < SCAN_CONFIDENCE_THRESHOLD);

  const recorded = await recordScanAttempts(
    user.id,
    body.setId,
    confident.map((m) => ({ mark: m, problemId: byPosition.get(m.problem_number)!.id }))
  );

  const grading: WorksheetGrading = {
    marks,
    page_note: result.page_note,
    needs_confirmation: uncertain.map((m) => m.problem_number),
    recorded,
  };
  await finishUpload(uploadId, "graded", grading);

  return Response.json({ uploadId, grading });
}

/**
 * Write the marks that were held back for confirmation.
 *
 * Only positions the model itself flagged are accepted, and only once — a
 * confirmed reading joins the record through the same duplicate-tolerant insert
 * as a confident one, so re-confirming can't overwrite an earlier outcome.
 */
async function confirmReadings(
  userId: string,
  uploadId: string,
  positions: number[]
): Promise<Response> {
  const upload = await getUpload(userId, uploadId);
  if (!upload?.grading) return Response.json({ error: "Not found" }, { status: 404 });

  const pending = new Set(upload.grading.needs_confirmation);
  const chosen = upload.grading.marks.filter(
    (m) => pending.has(m.problem_number) && positions.includes(m.problem_number)
  );
  if (chosen.length === 0) {
    return Response.json({ error: "Nothing left to confirm." }, { status: 409 });
  }

  const db = createServiceClient();
  const { data: items } = await db
    .from("problem_set_items")
    .select("position, problem_id")
    .eq("set_id", upload.set_id);
  const idAt = new Map(
    ((items ?? []) as { position: number; problem_id: string }[]).map((i) => [
      i.position,
      i.problem_id,
    ])
  );

  const recorded = await recordScanAttempts(
    userId,
    upload.set_id,
    chosen
      .filter((m) => idAt.has(m.problem_number))
      .map((m) => ({ mark: m, problemId: idAt.get(m.problem_number)! }))
  );

  const grading: WorksheetGrading = {
    ...upload.grading,
    needs_confirmation: upload.grading.needs_confirmation.filter((p) => !recorded.includes(p)),
    recorded: [...upload.grading.recorded, ...recorded],
  };
  await finishUpload(uploadId, "graded", grading);

  return Response.json({ uploadId, grading });
}
