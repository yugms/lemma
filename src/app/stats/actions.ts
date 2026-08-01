"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-server";
import { endSession, startSession } from "@/lib/study-session";

/**
 * Session controls. Unlike `deleteSet`, these write through the service client
 * after resolving the user server-side — `study_sessions` is select-only to
 * clients, the same shape as `attempts`, so RLS can't be the authorization
 * check here. The user id comes from the validated JWT, never the request body.
 *
 * Sessions scope the stats page, which guests don't get, so anonymous users are
 * turned away rather than silently accumulating rows they can never see.
 */

async function requireStudent(): Promise<{ id: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  if (user.is_anonymous) return { error: "Sign in to track study sessions." };
  return { id: user.id };
}

/** Both paths change the header chip, which lives in the layout. */
function revalidate() {
  revalidatePath("/stats");
  revalidatePath("/", "layout");
}

export async function startStudySession(): Promise<{ error?: string }> {
  const student = await requireStudent();
  if ("error" in student) return student;

  const session = await startSession(student.id);
  if (!session) return { error: "Could not start a session." };

  revalidate();
  return {};
}

export async function endStudySession(): Promise<{ error?: string }> {
  const student = await requireStudent();
  if ("error" in student) return student;

  await endSession(student.id);
  revalidate();
  return {};
}
