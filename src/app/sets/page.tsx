import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SetsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: sets } = user
    ? await supabase
        .from("problem_sets")
        .select("id, title, created_at, config")
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: null };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">My sets</h1>
        <Link
          href="/build"
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          New set
        </Link>
      </div>

      {!sets || sets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white py-16 text-center">
          <p className="text-zinc-500">No problem sets yet.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Build your first set and it will show up here.
            {!user && " (Guest history appears after your first set.)"}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {sets.map((s) => {
            const cfg = s.config as { count?: number; difficulty?: number; delivered?: number };
            return (
              <li key={s.id}>
                <Link
                  href={`/set/${s.id}`}
                  className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm"
                >
                  <div>
                    <p className="font-medium text-zinc-800">{s.title}</p>
                    <p className="text-xs text-zinc-400">
                      {cfg.delivered ?? cfg.count} problems · difficulty {cfg.difficulty} ·{" "}
                      {new Date(s.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-zinc-300">→</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
