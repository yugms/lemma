import { createServiceClient } from "@/lib/supabase/service";
import { renderInline, renderMath, renderProse } from "@/lib/math-render";
import { curveFromAuthored, plotFromSpec, renderPlot } from "@/lib/plot";
import { escapeMarkup } from "@/lib/escape-markup";
import {
  assertNeverFormat,
  assertNeverGraphResponse,
  type ProblemAnswerRecord,
  type ProblemContentRecord,
} from "@/lib/ai/schemas";

/**
 * The answer key for a printed worksheet.
 *
 * This is the only place besides `/api/check` that turns a stored answer into
 * something readable, and it exists rather than reusing that route's
 * `answerDisplay` because the two want different things: the route ships
 * structured fields for a live UI to mark up, while paper wants one compact
 * line per problem. The switch is exhaustive on purpose — `assertNeverFormat`
 * means a ninth format fails the typecheck here instead of printing a blank
 * answer nobody notices until the sheet is handed out.
 */

export type PrintKeyEntry = {
  position: number;
  /** Pre-rendered HTML — KaTeX runs in Node here, as it does everywhere else. */
  answer_html: string;
  /** Only graph sketches need a picture; everything else reads as a line. */
  solution_plot_svg?: string;
};

/**
 * Answers for every problem in a set, having first proved the caller owns it.
 *
 * The ownership check is the same one `loadSetForUser` makes, repeated rather
 * than assumed: this function reads the `answer` column, and a caller that
 * reaches it without owning the set is being handed an answer key.
 */
export async function loadAnswerKey(
  setId: string,
  userId: string
): Promise<PrintKeyEntry[] | null> {
  const db = createServiceClient();
  const { data: set } = await db
    .from("problem_sets")
    .select("id, owner_id")
    .eq("id", setId)
    .single();
  if (!set || set.owner_id !== userId) return null;

  const { data: items } = await db
    .from("problem_set_items")
    .select("position, problems(content, answer)")
    .eq("set_id", setId)
    .order("position");

  const rows = (items ?? []) as unknown as {
    position: number;
    problems: { content: ProblemContentRecord; answer: ProblemAnswerRecord } | null;
  }[];

  return rows
    .filter((row) => row.problems)
    .map((row) => ({
      position: row.position,
      ...renderAnswer(row.problems!.content, row.problems!.answer),
    }));
}

/**
 * One problem's answer, as printable HTML. Exported for `formats.test.ts`,
 * which drives it with a fixture per format so a format that prints an empty
 * key fails the suite rather than the worksheet.
 */
export function renderAnswer(
  content: ProblemContentRecord,
  answer: ProblemAnswerRecord
): { answer_html: string; solution_plot_svg?: string } {
  switch (content.format) {
    case "mcq": {
      const id = answer.correct_choice_id ?? "";
      const chosen = content.choices?.find((c) => c.id === id);
      return {
        answer_html: chosen
          ? // renderInline, not renderMath: a choice may be a sentence, and a
            // sentence in math mode loses the spaces between its words.
            `<strong>${escapeMarkup(id)}.</strong> ${renderInline(chosen.latex)}`
          : `<strong>${escapeMarkup(id)}</strong>`,
      };
    }

    case "multi_select":
      return { answer_html: `<strong>${escapeMarkup((answer.correct_choice_ids ?? []).join(", "))}</strong>` };

    case "ordering":
      return { answer_html: `<strong>${escapeMarkup((answer.correct_order ?? []).join(" → "))}</strong>` };

    case "open":
      return { answer_html: renderMath(answer.answer?.value_latex ?? "") };

    case "fill_blank":
      return {
        answer_html: (answer.blanks ?? [])
          .map((b) => `<strong>${b.index}.</strong> ${renderMath(b.answer.value_latex)}`)
          .join('<span class="mx-2 text-faint">·</span>'),
      };

    case "matching":
      // Both sides by id, since the printed problem lists them with those ids.
      return {
        answer_html: (answer.correct_pairs ?? [])
          .map((p) => `${escapeMarkup(p.left_id)}&nbsp;→&nbsp;${escapeMarkup(p.right_id)}`)
          .join('<span class="mx-2 text-faint">·</span>'),
      };

    case "multi_part":
      return {
        answer_html: (answer.parts ?? [])
          .map(
            (part) =>
              `<strong>${escapeMarkup(part.label)})</strong> ${renderMath(part.answer.value_latex)}`
          )
          .join('<span class="mx-2 text-faint">·</span>'),
      };

    case "graph": {
      // A graph problem with no stored kind is a read-a-value one, matching
      // what /api/check falls back to. Defaulted before the switch so the
      // exhaustiveness check below still has a closed set to work on.
      const kind = content.response_kind ?? "value";
      switch (kind) {
        case "value":
          return { answer_html: renderMath(answer.answer?.value_latex ?? "") };
        case "points":
          return {
            answer_html: (answer.correct_points ?? [])
              .map((p) => `(${p.x},&nbsp;${p.y})`)
              .join('<span class="mx-2 text-faint">·</span>'),
          };
        case "sketch": {
          // "Draw this" has a picture for an answer, so the key carries the
          // plot with the target curve on it. A list of coefficients would
          // leave whoever is marking to plot it themselves.
          const plot = content.plot ? plotFromSpec(content.plot) : null;
          const target = answer.target_curve ? curveFromAuthored(answer.target_curve) : null;
          return {
            answer_html: renderProse("The curve shown."),
            solution_plot_svg:
              plot && target
                ? renderPlot({ ...plot, curves: [...plot.curves, target] })
                : undefined,
          };
        }
        default:
          return assertNeverGraphResponse(kind);
      }
    }

    default:
      return assertNeverFormat(content.format);
  }
}

