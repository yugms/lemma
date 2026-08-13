import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth-server";
import { loadProgressForSets } from "@/lib/progress";
import { formatRelativeDate } from "@/lib/format";
import { SetRow, type SetRowData } from "@/components/sets/set-row";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My sets",
  description:
    "Every problem set you've built, newest first, with how far through each one you are.",
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Kept out of the component body — reading the clock during render isn't pure. */
function groupByRecency(sets: SetRowData[]) {
  const cutoff = Date.now() - WEEK_MS;
  const recent: SetRowData[] = [];
  const earlier: SetRowData[] = [];
  for (const s of sets) {
    (new Date(s.createdAt).getTime() >= cutoff ? recent : earlier).push(s);
  }
  return [
    { label: "This week", items: recent },
    { label: "Earlier", items: earlier },
  ].filter((g) => g.items.length > 0);
}

export default async function SetsPage() {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);

  // The item count comes from the join rather than config, so a set that was
  // delivered short reports what it actually holds.
  const { data: sets } = user
    ? await supabase
        .from("problem_sets")
        .select("id, title, created_at, config, problem_set_items(count)")
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: null };

  const rows = (sets ?? []) as unknown as {
    id: string;
    title: string;
    created_at: string;
    config: { count?: number; difficulty?: number; delivered?: number };
    problem_set_items: { count: number }[];
  }[];

  const progress = user
    ? await loadProgressForSets(
        rows.map((r) => r.id),
        user.id
      )
    : new Map();

  const data: SetRowData[] = rows.map((r) => {
    const tally = progress.get(r.id);
    return {
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      createdLabel: formatRelativeDate(r.created_at),
      total:
        r.problem_set_items?.[0]?.count ?? r.config.delivered ?? r.config.count ?? 0,
      difficulty: r.config.difficulty ?? 1,
      attempted: tally?.attempted ?? 0,
    };
  });

  const groups = groupByRecency(data);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="flex flex-wrap items-end justify-between gap-6 pb-10">
        <div>
          <p className="eyebrow eyebrow-accent">Library</p>
          <h1 className="display mt-5 text-title">My sets</h1>
        </div>
        <Link href="/build" transitionTypes={["nav-forward"]} className="btn btn-accent">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New set
        </Link>
      </header>

      {data.length === 0 ? (
        <div className="panel flex flex-col items-center px-6 py-20 text-center">
          <h2 className="display-md text-section">Nothing here yet</h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
            Build your first set and it will show up here.
            {!user && " Guest history appears after your first set."}
          </p>
          <Link href="/build" transitionTypes={["nav-forward"]} className="btn btn-accent mt-8">
            Build a set
          </Link>
        </div>
      ) : (
        <div className="space-y-12">
          {groups.map((group) => (
            <section key={group.label}>
              <h2 className="eyebrow border-b border-line pb-3">{group.label}</h2>
              <ul>
                {group.items.map((s) => (
                  <SetRow key={s.id} set={s} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
