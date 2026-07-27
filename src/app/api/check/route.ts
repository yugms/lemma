import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkSubmission, wrongAnswerFeedback } from "@/lib/ai/check-answer";
import type {
  ProblemAnswerRecord,
  ProblemContentRecord,
  ProblemExplanationRecord,
} from "@/lib/ai/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  problemId: z.string().uuid(),
  setId: z.string().uuid().nullable(),
  mode: z.enum(["practice", "flashcard", "quiz"]),
  /** "reveal" records a give-up; "answer" grades the submission */
  action: z.enum(["answer", "reveal"]),
  answer: z.unknown().optional(),
  timeMs: z.number().int().min(0).max(3_600_000).optional(),
});

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

  // This route hands back the answer and the worked solution, so the problem
  // must appear in a set this user owns. Problems are pooled across users, so
  // checking the set alone (or skipping the check when setId is null) would let
  // any signed-in user read the answer key for an arbitrary problem id.
  let ownership = db
    .from("problem_set_items")
    .select("set_id, problem_sets!inner(owner_id)")
    .eq("problem_id", body.problemId)
    .eq("problem_sets.owner_id", user.id);
  if (body.setId) ownership = ownership.eq("set_id", body.setId);
  const { data: owned } = await ownership.limit(1);
  if (!owned || owned.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { data: problem } = await db
    .from("problems")
    .select("id, content, answer, explanation")
    .eq("id", body.problemId)
    .single();
  if (!problem) return Response.json({ error: "Not found" }, { status: 404 });

  const content = problem.content as ProblemContentRecord;
  const answer = problem.answer as ProblemAnswerRecord;
  const explanation = problem.explanation as ProblemExplanationRecord;

  const answerDisplay =
    content.format === "mcq"
      ? {
          correct_choice_id: answer.correct_choice_id,
          value_latex:
            content.choices?.find((c) => c.id === answer.correct_choice_id)?.latex ?? "",
        }
      : content.format === "open"
        ? { value_latex: answer.answer?.value_latex ?? "" }
        : {
            blanks: (answer.blanks ?? []).map((b) => ({
              index: b.index,
              value_latex: b.answer.value_latex,
            })),
          };

  if (body.action === "reveal") {
    await db.from("attempts").insert({
      user_id: user.id,
      set_id: body.setId,
      problem_id: body.problemId,
      mode: body.mode,
      answer: null,
      is_correct: null,
      time_ms: body.timeMs ?? null,
    });
    return Response.json({ revealed: true, answer: answerDisplay, explanation });
  }

  const outcome = await checkSubmission(content, answer, body.answer);
  let feedback = null;
  if (!outcome.correct) {
    feedback = await wrongAnswerFeedback(content, answer, explanation, body.answer);
  }

  await db.from("attempts").insert({
    user_id: user.id,
    set_id: body.setId,
    problem_id: body.problemId,
    mode: body.mode,
    answer: body.answer as never,
    is_correct: outcome.correct,
    ai_feedback: feedback,
    time_ms: body.timeMs ?? null,
  });

  return Response.json({
    correct: outcome.correct,
    feedback,
    answer: answerDisplay,
    explanation,
  });
}
