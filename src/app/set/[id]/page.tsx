import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadSetForUser } from "@/lib/sets";
import { MathProse } from "@/components/latex";

export const dynamic = "force-dynamic";

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const result = await loadSetForUser(id, user.id);
  if (!result) notFound();
  const { set, problems } = result;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{set.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {problems.length} problems · difficulty {set.config.difficulty} · created{" "}
            {new Date(set.created_at).toLocaleDateString()}
          </p>
        </div>
        <Link
          href={`/set/${set.id}/practice`}
          className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
        >
          Start practicing
        </Link>
      </div>

      <ol className="space-y-3">
        {problems.map((p) => (
          <li key={p.id} className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-400">
              <span className="font-semibold text-zinc-500">#{p.position}</span>
              {p.topic_title && <span>{p.topic_title}</span>}
              <span className="rounded-full bg-zinc-100 px-2 py-0.5">{p.format.replace("_", " ")}</span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5">lvl {p.difficulty}</span>
            </div>
            <MathProse text={p.statement_latex} className="text-sm leading-6 text-zinc-700" />
          </li>
        ))}
      </ol>
    </div>
  );
}
