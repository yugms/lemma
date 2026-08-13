import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkSubmission, wrongAnswerFeedback } from "@/lib/ai/check-answer";
import { renderInline, renderMath, renderProse } from "@/lib/math-render";
import { curveFromAuthored, plotFromSpec, renderPlot } from "@/lib/plot";
import { assertNeverFormat } from "@/lib/ai/kinds";
import {
  ATTEMPT_MODES,
  MAX_TIME_MS,
  MODE_RULES,
  retryEligible,
  shouldDisclose,
} from "@/lib/attempt-state";
import { aiGradingAllowed } from "@/lib/limits";
import type {
  CheckResponse,
  FeedbackResult,
  ProblemAnswerRecord,
  ProblemContentRecord,
  ProblemExplanationRecord,
} from "@/lib/ai/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  problemId: z.string().uuid(),
  setId: z.string().uuid().nullable(),
  mode: z.enum(ATTEMPT_MODES),
  /**
   * "answer" grades the submission, "reveal" records a give-up, "retry" takes a
   * second run at a problem already answered wrong, and "recall" re-reads an
   * outcome the student already earned. "recall" is the only one that never
   * writes; "retry" writes a second row that no score ever reads.
   */
  action: z.enum(["answer", "reveal", "recall", "retry"]),
  answer: z.unknown().optional(),
  timeMs: z.number().int().min(0).max(MAX_TIME_MS).optional(),
});

type PriorAttempt = {
  is_correct: boolean | null;
  ai_feedback: unknown;
  answer: unknown;
  attempt_no: number;
};

/**
 * What is already on record for this problem: the graded first attempt, and the
 * retry if one was taken.
 *
 * Scoped to the set whenever the caller names one. Problems are pooled, so the
 * same row can sit in two of a student's sets; an outcome earned in one must
 * not be reported as the other's, or the card and the set-scoped nav dots state
 * two different things about the same problem.
 */
async function loadAttempts(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  problemId: string,
  setId: string | null
): Promise<{ first: PriorAttempt | null; retry: PriorAttempt | null }> {
  let query = db
    .from("attempts")
    .select("is_correct, ai_feedback, answer, attempt_no")
    .eq("user_id", userId)
    .eq("problem_id", problemId);
  if (setId) query = query.eq("set_id", setId);
  const { data } = await query.order("created_at", { ascending: true }).limit(4);
  const rows = (data ?? []) as PriorAttempt[];
  return {
    first: rows.find((r) => r.attempt_no === 1) ?? rows[0] ?? null,
    retry: rows.find((r) => r.attempt_no === 2) ?? null,
  };
}

function renderFeedback(raw: unknown): CheckResponse["feedback"] {
  if (!raw) return null;
  const f = raw as FeedbackResult;
  if (!f.what_went_wrong_latex && !f.next_hint) return null;
  return {
    what_went_wrong_html: renderProse(f.what_went_wrong_latex ?? ""),
    next_hint_html: renderProse(f.next_hint ?? ""),
    // Named rather than narrated — the mistake log groups on this.
    misconception: f.likely_misconception || undefined,
  };
}

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

  // KaTeX runs here, in Node, so the browser never loads it.
  const answerDisplay = (): NonNullable<CheckResponse["answer"]> => {
    switch (content.format) {
      case "mcq":
        return {
          correct_choice_id: answer.correct_choice_id,
          // Matches how the choice itself was rendered — a sentence choice
          // would otherwise read back as run-together math in the verdict.
          value_html: renderInline(
            content.choices?.find((c) => c.id === answer.correct_choice_id)?.latex ?? ""
          ),
        };
      case "multi_select":
        return { correct_choice_ids: answer.correct_choice_ids ?? [] };
      case "ordering":
        return { correct_order: answer.correct_order ?? [] };
      case "open":
        return { value_html: renderMath(answer.answer?.value_latex ?? "") };
      case "fill_blank":
        return {
          blanks: (answer.blanks ?? []).map((b) => ({
            index: b.index,
            html: renderMath(b.answer.value_latex),
          })),
        };
      case "matching":
        // Ids only — both columns are already on the client, so sending the
        // pairing is enough to mark up what was right.
        return { correct_pairs: answer.correct_pairs ?? [] };
      case "multi_part":
        return {
          part_answers: (answer.parts ?? []).map((part) => ({
            label: part.label,
            html: renderMath(part.answer.value_latex),
          })),
        };
      case "graph": {
        if (content.response_kind === "points") {
          return { correct_points: answer.correct_points ?? [] };
        }
        if (content.response_kind === "sketch") {
          // The answer to "draw this" is a picture, so it is rendered as one —
          // the coefficients alone would leave the student to plot the key by
          // hand to find out what they should have produced.
          const plot = content.plot ? plotFromSpec(content.plot) : null;
          const target = answer.target_curve ? curveFromAuthored(answer.target_curve) : null;
          return {
            target_curve: answer.target_curve,
            solution_plot_svg:
              plot && target
                ? renderPlot(
                    { ...plot, curves: [...plot.curves, target] },
                    { title: "The correct curve" }
                  )
                : undefined,
          };
        }
        return { value_html: renderMath(answer.answer?.value_latex ?? "") };
      }
      default:
        return assertNeverFormat(content.format);
    }
  };

  const explanationDisplay = (): NonNullable<CheckResponse["explanation"]> => ({
    steps: (explanation.steps ?? []).map((s) => ({
      math_html: s.latex ? renderMath(s.latex) : null,
      note_html: renderProse(s.note),
    })),
  });

  /**
   * Why each wrong option was tempting, authored with the problem and until now
   * used only as hidden input to the feedback model. Disclosed on the same
   * terms as the worked solution: never before an attempt is on record.
   */
  const choiceNotes = (): CheckResponse["choice_notes"] => {
    const notes = answer.distractor_rationales ?? [];
    if (notes.length === 0) return undefined;
    return notes.map((d) => ({ choice_id: d.choice_id, html: renderProse(d.misconception) }));
  };

  /** Everything the student is entitled to once the problem is finished. */
  const disclosure = () => ({
    answer: answerDisplay(),
    explanation: explanationDisplay(),
    choice_notes: choiceNotes(),
  });

  const rules = MODE_RULES[body.mode];

  /**
   * Flashcards are repeatable drilling, so they are stored unscoped: a set's
   * score is a record of working through it once, and a tenth rep of the same
   * card is not evidence about that. Storing null also keeps them clear of
   * `attempts_one_per_attempt`, which is what makes repetition possible at all.
   * The set id still arrives on the request and still gates ownership above.
   */
  const storedSetId = rules.scored ? body.setId : null;

  // With nothing scoped, there is no prior-attempt state to consult.
  const { first, retry } = rules.scored
    ? await loadAttempts(db, user.id, body.problemId, body.setId)
    : { first: null, retry: null };
  const canRetry = retryEligible(body.setId, first, retry, body.mode);

  const replayOf = (last: PriorAttempt, retryRow: PriorAttempt | null, eligible: boolean) => {
    // Two independent reasons to stay quiet, and replay has to honour both.
    // Without the mode check, re-submitting a quiz answer would replay the
    // stored attempt *with* the answer key — turning a duplicate submission
    // into the quiz's own answer sheet.
    const open = rules.discloses && shouldDisclose(eligible);
    return Response.json({
      correct: rules.discloses ? (last.is_correct ?? undefined) : undefined,
      revealed: rules.discloses ? last.is_correct === null : undefined,
      recorded: rules.discloses ? undefined : true,
      feedback: rules.discloses ? renderFeedback(last.ai_feedback) : undefined,
      ...(open ? disclosure() : {}),
      submitted: last.answer ?? undefined,
      retry: retryRow
        ? { correct: retryRow.is_correct === true, submitted: retryRow.answer ?? undefined }
        : null,
      can_retry: eligible,
    } satisfies CheckResponse);
  };

  const replay = (last: PriorAttempt) => replayOf(last, retry, canRetry);

  /**
   * Resolve a failed attempt write.
   *
   * `attempts_one_per_attempt` makes concurrent submissions of the same problem
   * race: both read no prior attempt, both grade, and the loser's insert is
   * rejected. Returning the verdict anyway would tell the student their answer
   * was recorded when the row on file is the other request's — so re-read, and
   * replay whatever actually landed. Any other write failure has to surface: a
   * graded answer that reached no table is progress the student silently loses.
   */
  async function settle(error: { message: string } | null): Promise<Response | null> {
    if (!error) return null;
    const fresh = await loadAttempts(db, user!.id, body!.problemId, body!.setId);
    if (fresh.first) {
      return replayOf(
        fresh.first,
        fresh.retry,
        retryEligible(body!.setId, fresh.first, fresh.retry, body!.mode)
      );
    }
    return Response.json(
      { error: "Couldn't record that answer — try again." },
      { status: 503 }
    );
  }

  // Replaying a finished problem. Reading back an outcome the student already
  // earned must not mint a new attempt, or revisiting would rewrite history —
  // and no prior attempt means no entitlement to the answer key.
  if (body.action === "recall") {
    if (!first) return Response.json({ error: "Not attempted yet" }, { status: 404 });
    return replay(first);
  }

  if (body.action === "retry") {
    if (!canRetry) {
      return Response.json(
        { error: "No retry available for this problem." },
        { status: 409 }
      );
    }
    const allowAi = await aiGradingAllowed(user.id, user.is_anonymous ?? false);
    const correct = await checkSubmission(content, answer, body.answer, { allowAi });
    // Diagnose the second attempt on its own terms. Reusing the first attempt's
    // note would explain an answer the student is no longer giving, and the
    // retry is the one moment the diagnosis matters most.
    const retryFeedback =
      correct || !allowAi
        ? null
        : await wrongAnswerFeedback(content, answer, explanation, body.answer);

    // The retry is the last word, so the solution is disclosed either way.
    const { error } = await db.from("attempts").insert({
      user_id: user.id,
      set_id: body.setId,
      problem_id: body.problemId,
      mode: body.mode,
      answer: body.answer as never,
      is_correct: correct,
      ai_feedback: retryFeedback,
      time_ms: body.timeMs ?? null,
      attempt_no: 2,
    });
    // A unique violation means a concurrent retry already landed. Nothing is
    // lost — that row holds the same kind of outcome this one would have.
    if (error) return Response.json({ error: "No retry available for this problem." }, { status: 409 });

    return Response.json({
      // The first attempt is what scored the set; this response describes the
      // retry, and the client keeps the two apart.
      correct: first!.is_correct ?? undefined,
      feedback: renderFeedback(retryFeedback ?? first!.ai_feedback),
      ...disclosure(),
      submitted: first!.answer ?? undefined,
      retry: { correct, submitted: body.answer },
      can_retry: false,
    } satisfies CheckResponse);
  }

  // Practice is one shot per problem: the set score, the derived progress and
  // every statistic downstream assume an outcome is earned once. A stray second
  // submission — a stale tab, a double Enter, a card that rendered before its
  // history arrived — replays what is on record instead of overwriting it.
  if (first) return replay(first);

  if (body.action === "reveal") {
    const { error } = await db.from("attempts").insert({
      user_id: user.id,
      set_id: storedSetId,
      problem_id: body.problemId,
      mode: body.mode,
      answer: null,
      is_correct: null,
      time_ms: body.timeMs ?? null,
    });
    const settled = await settle(error);
    if (settled) return settled;
    return Response.json({ revealed: true, ...disclosure() } satisfies CheckResponse);
  }

  // A day's grading budget covers both the equivalence check and the
  // diagnosis. Over it, the answer is still graded — locally — and only the
  // explanation is lost. See `aiGradingAllowed`.
  const allowAi = await aiGradingAllowed(user.id, user.is_anonymous ?? false);
  const correct = await checkSubmission(content, answer, body.answer, { allowAi });
  let feedback = null;
  if (!correct && allowAi) {
    feedback = await wrongAnswerFeedback(content, answer, explanation, body.answer);
  }

  const { error: writeErr } = await db.from("attempts").insert({
    user_id: user.id,
    set_id: storedSetId,
    problem_id: body.problemId,
    mode: body.mode,
    answer: body.answer as never,
    is_correct: correct,
    ai_feedback: feedback,
    time_ms: body.timeMs ?? null,
  });
  const settled = await settle(writeErr);
  if (settled) return settled;

  // A quiz records the outcome and says nothing back. Grading it live would
  // make it a practice run with a clock on it — the whole difference is that
  // you find out how you did when you hand it in. The diagnosis is still
  // generated and stored above, so review afterwards is fully populated.
  if (!rules.discloses) {
    return Response.json({ recorded: true } satisfies CheckResponse);
  }

  // A wrong answer that can still be retried gets the diagnosis but not the
  // key: revealing it here and then offering "try again" would reduce the
  // second attempt to copying. The row just written is this problem's first
  // attempt, so the same rule applies with it standing in as `first`.
  const canRetryNow = retryEligible(
    body.setId,
    { is_correct: correct },
    null,
    body.mode
  );
  if (canRetryNow) {
    return Response.json({
      correct: false,
      feedback: renderFeedback(feedback),
      can_retry: true,
    } satisfies CheckResponse);
  }

  return Response.json({
    correct,
    feedback: renderFeedback(feedback),
    ...disclosure(),
    can_retry: false,
  } satisfies CheckResponse);
}
