import Link from "next/link";
import type { StatsScope } from "@/lib/analytics";

const OPTIONS: { scope: StatsScope; href: string; label: string }[] = [
  { scope: "all", href: "/stats", label: "All time" },
  { scope: "session", href: "/stats?scope=session", label: "This session" },
];

/**
 * Links rather than buttons, so the scope lives in the URL: shareable,
 * back-button-correct, and no client JavaScript at all. `.chip` picks up
 * `aria-current` for the selected style — `aria-pressed` is button-only.
 */
export function ScopeToggle({ scope }: { scope: StatsScope }) {
  return (
    <div role="group" aria-label="Time range" className="flex flex-wrap gap-2">
      {OPTIONS.map((o) => (
        <Link
          key={o.scope}
          href={o.href}
          replace
          scroll={false}
          transitionTypes={["nav-lateral"]}
          aria-current={o.scope === scope ? "page" : undefined}
          className="chip"
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
