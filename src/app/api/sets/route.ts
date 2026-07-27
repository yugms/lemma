import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildProblemSet } from "@/lib/sets";
import { PROBLEM_FORMATS, PROBLEM_STYLES } from "@/lib/ai/schemas";

export const runtime = "nodejs";
export const maxDuration = 300;

const ConfigSchema = z.object({
  topicIds: z.array(z.string().uuid()).min(1).max(6),
  count: z.number().int().min(1).max(15),
  difficulty: z.number().int().min(1).max(5),
  styles: z.array(z.enum(PROBLEM_STYLES)).min(1),
  formats: z.array(z.enum(PROBLEM_FORMATS)).min(1),
  title: z.string().max(120).optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  let config;
  try {
    config = ConfigSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        for await (const event of buildProblemSet(user.id, user.is_anonymous ?? false, config)) {
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
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
