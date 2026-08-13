import { requestFailed } from "@/lib/post-json";
import type { BuildEvent } from "@/lib/sets";

/**
 * Client half of the set-building stream.
 *
 * `POST /api/sets` answers with SSE, which `EventSource` can't consume because
 * it only speaks GET — hence the hand-rolled reader. Shared by the builder form
 * and the stats page's targeted-set cards so the parser exists once.
 *
 * Deliberately free of any Supabase import: callers do their own
 * `await import("@/lib/auth")` for `ensureUser()` at click time, which is what
 * keeps the SDK out of every route's initial bundle.
 */
export async function* streamBuild(body: unknown): AsyncGenerator<BuildEvent> {
  const res = await fetch("/api/sets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw await requestFailed(res, `Request failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as BuildEvent;
      if (event.type === "complete" || event.type === "error") terminated = true;
      yield event;
    }
  }

  // A stream that stops without a verdict means the platform cut it off.
  if (!terminated) throw new Error("Generation ended unexpectedly. Please try again.");
}
