import { Prose } from "@/components/latex";
import { assertNeverFormat, assertNeverGraphResponse } from "@/lib/ai/kinds";
import type { PreparedProblem } from "@/lib/ai/schemas";

/**
 * Where the student writes, sized to the format.
 *
 * On paper the answer area *is* the question's interface, so it has to differ
 * per format the way the interactive inputs do: multiple choice needs its
 * options listed, ordering needs one slot per step, and an open answer needs
 * room to show working. Exhaustive so a new format cannot silently print a
 * problem with nowhere to answer it.
 */
export function AnswerSpace({ problem }: { problem: PreparedProblem }) {
  switch (problem.format) {
    case "mcq":
    case "multi_select":
      return (
        <ul className="mt-4 space-y-2.5">
          {(problem.choices ?? []).map((choice) => (
            <li key={choice.id} className="flex items-baseline gap-3">
              {/* A box rather than a letter in a circle: it is what you tick. */}
              <span
                aria-hidden
                className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 border border-line-strong"
              />
              <span className="mono-meta w-4 shrink-0">{choice.id}</span>
              <Prose html={choice.html} className="text-[15px] leading-6" />
            </li>
          ))}
          {problem.format === "multi_select" && (
            <li className="mono-meta pt-1">Tick every one that applies.</li>
          )}
        </ul>
      );

    case "ordering":
      return (
        <div className="mt-4">
          <ul className="space-y-2.5">
            {(problem.items ?? []).map((item) => (
              <li key={item.id} className="flex items-baseline gap-3">
                <span
                  aria-hidden
                  className="inline-block w-8 shrink-0 border-b border-line-strong"
                />
                <span className="mono-meta w-4 shrink-0">{item.id}</span>
                <Prose html={item.html} className="text-[15px] leading-6" />
              </li>
            ))}
          </ul>
          <p className="mono-meta mt-3">Number them 1 upwards in the blanks.</p>
        </div>
      );

    case "matching":
      return (
        <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <ul className="space-y-2.5">
            {(problem.left ?? []).map((item) => (
              <li key={item.id} className="flex items-baseline gap-3">
                <span className="mono-meta w-4 shrink-0">{item.id}</span>
                <Prose html={item.html} className="flex-1 text-[15px] leading-6" />
                <span
                  aria-hidden
                  className="inline-block w-8 shrink-0 border-b border-line-strong"
                />
              </li>
            ))}
          </ul>
          <ul className="space-y-2.5">
            {(problem.right ?? []).map((item) => (
              <li key={item.id} className="flex items-baseline gap-3">
                <span className="mono-meta w-4 shrink-0">{item.id}</span>
                <Prose html={item.html} className="text-[15px] leading-6" />
              </li>
            ))}
          </ul>
          <p className="mono-meta sm:col-span-2">
            Write the matching right-hand letter beside each item on the left. Not every
            one on the right is used.
          </p>
        </div>
      );

    case "multi_part":
      return (
        <div className="mt-4 space-y-5">
          {(problem.parts ?? []).map((part) => (
            <div key={part.label}>
              <div className="flex items-baseline gap-2">
                <span className="mono-meta shrink-0">{part.label})</span>
                <Prose html={part.prompt_html} className="text-[15px] leading-6" />
              </div>
              <Rules count={2} />
            </div>
          ))}
        </div>
      );

    case "fill_blank":
      // The blanks are already drawn into the statement by renderProse, so all
      // this needs to add is somewhere to show working.
      return <Rules count={2} />;

    case "open":
      return <Rules count={4} />;

    case "graph": {
      // Defaulted before the switch so a stored problem with no kind still
      // reads as "write the value down", while the switch keeps a closed set
      // and a fourth kind becomes a compile error rather than a blank space.
      const kind = problem.response_kind ?? "value";
      switch (kind) {
        case "points":
          return (
            <>
              <p className="mono-meta mt-3">Mark the points on the graph above.</p>
              <Rules count={1} label="Coordinates" />
            </>
          );
        case "sketch":
          return <p className="mono-meta mt-3">Draw your curve on the graph above.</p>;
        case "value":
          return <Rules count={2} />;
        default:
          return assertNeverGraphResponse(kind);
      }
    }

    default:
      return assertNeverFormat(problem.format);
  }
}

/** Ruled lines to write on. Faint enough not to dominate a photocopy. */
function Rules({ count, label }: { count: number; label?: string }) {
  return (
    <div className="mt-3 space-y-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-baseline gap-2">
          {i === 0 && label && <span className="mono-meta shrink-0">{label}</span>}
          <span aria-hidden className="block flex-1 border-b border-line" />
        </div>
      ))}
    </div>
  );
}
