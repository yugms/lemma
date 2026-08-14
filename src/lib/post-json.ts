/**
 * The one way the browser talks to this app's JSON routes.
 *
 * Five call sites had written this out in three different shapes, and one of
 * the shapes was wrong: reading `await res.json()` *before* checking `res.ok`
 * throws a SyntaxError on any failure whose body isn't JSON — a platform 502,
 * a gateway timeout — so the student was shown "Unexpected token <" instead of
 * the sentence the call site had ready for exactly that case.
 *
 * Dependency-free on purpose: every caller is a `"use client"` component, and
 * this module sits in their static import graph.
 */

/**
 * The server refused, in the terms it refused in.
 *
 * `status` and `body` are carried because a refusal is sometimes a
 * destination: `/api/materials` answers 422 with the id of the material it
 * declined, whose own page explains the rejection in our words.
 */
export class RequestFailed extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super(message);
    this.name = "RequestFailed";
  }
}

/** Build the error for a response that failed, preferring the server's own message. */
export async function requestFailed(res: Response, fallback: string): Promise<RequestFailed> {
  const body = await res.json().catch(() => null);
  const parsed = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const message = typeof parsed.error === "string" ? parsed.error : fallback;
  return new RequestFailed(message, res.status, parsed);
}

/** POST JSON and read JSON back, or throw `RequestFailed`. */
export async function postJson<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await requestFailed(res, fallback);
  return (await res.json()) as T;
}
