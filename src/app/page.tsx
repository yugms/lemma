import Link from "next/link";

const FEATURES = [
  {
    title: "Pick exactly what to practice",
    body: "Choose a course, unit, or single topic — from Algebra 1 through AP Calculus BC, plus AMC-style competition math.",
  },
  {
    title: "Problems you can trust",
    body: "Every AI-written problem is independently re-solved and checked for correctness, difficulty, and clarity before you ever see it.",
  },
  {
    title: "Learn from every miss",
    body: "Wrong answer? You get a diagnosis of what likely went wrong and a full step-by-step solution — not just the answer.",
  },
];

export default function Home() {
  return (
    <div className="space-y-16 py-8">
      <section className="text-center space-y-6">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Math practice,{" "}
          <span className="text-indigo-600">generated for you</span>
        </h1>
        <p className="mx-auto max-w-xl text-lg text-zinc-600">
          Build a custom problem set in seconds: pick the topic, difficulty, and
          style, then practice with instant feedback and worked solutions.
        </p>
        <div className="flex justify-center gap-3">
          <Link
            href="/build"
            className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
          >
            Build a problem set
          </Link>
          <Link
            href="/sets"
            className="rounded-xl border border-zinc-300 bg-white px-6 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
          >
            My sets
          </Link>
        </div>
        <p className="text-xs text-zinc-400">
          No account needed — sign in with Google to keep your history.
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-zinc-200 bg-white p-6">
            <h3 className="font-semibold mb-2">{f.title}</h3>
            <p className="text-sm text-zinc-600 leading-6">{f.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
