import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildProblemSet, type SetConfig } from "@/lib/sets";
import { PROBLEM_FORMATS, PROBLEM_STYLES } from "@/lib/ai/schemas";
import { loadStatsSnapshot, windowFor } from "@/lib/analytics";
import { cachedCoachRead } from "@/lib/ai/coach";
import { loadLatestSession } from "@/lib/study-session";
import { prescribe, PLAN_IDS } from "@/lib/coach-plan";
import { ipAllowance } from "@/lib/limits";

export const runtime = "nodejs";
export const maxDuration = 300;

const ManualSchema = z.object({
  mode: z.literal("manual").optional(),
  topicIds: z.array(z.string().uuid()).min(1).max(6),
  count: z.number().int().min(1).max(15),
  difficulty: z.number().int().min(1).max(5),
  styles: z.array(z.enum(PROBLEM_STYLES)).min(1),
  formats: z.array(z.enum(PROBLEM_FORMATS)).min(1),
  title: z.string().max(120).optional(),
});

/**
 * A targeted build takes a plan id and nothing else. The config — topics,
 * difficulty, and above all the authoring directives — is rebuilt here from the
 * caller's own attempt history. That is the whole security boundary: `focus`
 * reaches the model prompt verbatim, so it must never be something a client can
 * write.
 */
const TargetedSchema = z.object({
  mode: z.literal("targeted"),
  plan: z.enum(PLAN_IDS),
  scope: z.enum(["all", "session"]).default("all"),
});

const BodySchema = z.union([TargetedSchema, ManualSchema]);

export async function POST(request: NextRequest) {
  // The generation budget is measured from here, not from where generation
  // starts — a targeted build resolves a coach read first, and that time is
  // charged to the same invocation.
  const requestStartedAt = Date.now();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  let body;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  // Ahead of the branch below, not next to the per-user cap inside
  // `buildProblemSet`: a targeted build resolves a coach read first, which can
  // spend 45s of model time before generation is even reached.
  const networkAllowance = await ipAllowance("generatedSets", request.headers);
  if (!networkAllowance.ok) {
    return Response.json({ error: networkAllowance.message }, { status: 429 });
  }

  let config: SetConfig;
  if (body.mode === "targeted") {
    // Targeted sets are the payoff for having a history, which guests don't keep.
    if (user.is_anonymous) {
      return Response.json(
        { error: "Sign in to build a set from your practice history." },
        { status: 403 }
      );
    }
    const scope = body.scope;
    const session = scope === "session" ? await loadLatestSession(user.id) : null;
    // `cachedCoachRead` never calls the model and doesn't need the snapshot, so
    // the two run together instead of queueing. Nothing before generation may
    // block on a model here — see the note on `cachedCoachRead`.
    const [snapshot, coach] = await Promise.all([
      loadStatsSnapshot(user.id, windowFor(scope, session)),
      cachedCoachRead(user.id, scope),
    ]);
    const chosen = prescribe(snapshot, coach).find((p) => p.id === body.plan);
    if (!chosen) {
      return Response.json(
        { error: "Not enough practice history for that plan yet." },
        { status: 409 }
      );
    }
    config = chosen.config;
  } else {
    // `mode` is routing, not configuration — keep it out of the stored jsonb.
    config = {
      topicIds: body.topicIds,
      count: body.count,
      difficulty: body.difficulty,
      styles: body.styles,
      formats: body.formats,
      title: body.title,
    };
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        for await (const event of buildProblemSet(
          user.id,
          user.is_anonymous ?? false,
          config,
          requestStartedAt
        )) {
          send(event);
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unexpected error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      // `no-transform` is the load-bearing half: it stops a proxy buffering the
      // stream, which would hold every build event back until the set finished.
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
