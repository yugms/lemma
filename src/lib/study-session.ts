import { createServiceClient } from "@/lib/supabase/service";

/**
 * A study session: a stretch of practice the student opens and closes by hand,
 * used to scope the stats page to "this session" instead of all time.
 *
 * It is a row rather than a cookie because the student expects it to outlive a
 * sign-out. `linkIdentity()` preserves the user id through the anonymous ->
 * Google upgrade, so a session started as a guest is still theirs afterwards.
 *
 * Named `study-session` throughout to keep it distinct from the auth session.
 */

export type StudySession = {
  id: string;
  startedAt: string;
  /** Null while the session is running. */
  endedAt: string | null;
};

type Row = { id: string; started_at: string; ended_at: string | null };

const toSession = (r: Row): StudySession => ({
  id: r.id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
});

export async function loadActiveSession(userId: string): Promise<StudySession | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("study_sessions")
    .select("id, started_at, ended_at")
    .eq("user_id", userId)
    .is("ended_at", null)
    .limit(1);
  const row = (data as Row[] | null)?.[0];
  return row ? toSession(row) : null;
}

/**
 * The active session, or the most recent finished one. Scoping to "this
 * session" right after ending one should still show what you just did rather
 * than emptying the page.
 */
export async function loadLatestSession(userId: string): Promise<StudySession | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("study_sessions")
    .select("id, started_at, ended_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1);
  const row = (data as Row[] | null)?.[0];
  return row ? toSession(row) : null;
}

/**
 * Start a session, or return the one already running.
 *
 * Starting must never restart: a double-submit that closed the open session and
 * opened a fresh one would silently throw away the elapsed time the student was
 * watching. The check below handles the ordinary case and the partial unique
 * index handles the race, where losing means someone else already created the
 * session we wanted — so read it back rather than erroring.
 */
export async function startSession(userId: string): Promise<StudySession | null> {
  const existing = await loadActiveSession(userId);
  if (existing) return existing;

  const db = createServiceClient();
  const { data, error } = await db
    .from("study_sessions")
    .insert({ user_id: userId })
    .select("id, started_at, ended_at")
    .single();

  if (error) return loadActiveSession(userId);
  return toSession(data as Row);
}

export async function endSession(userId: string): Promise<void> {
  const db = createServiceClient();
  await db
    .from("study_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("ended_at", null);
}
