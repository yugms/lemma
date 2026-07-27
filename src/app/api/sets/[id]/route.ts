import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadSetForUser } from "@/lib/sets";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const result = await loadSetForUser(id, user.id);
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(result);
}
