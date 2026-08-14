/**
 * Reading a set back.
 *
 * Apart from the build pipeline because it shares nothing with it but the
 * `SetConfig` type, and because of what the sharing cost: `share.ts` needs
 * `sanitizeItems` and `ITEM_SELECT`, and importing them from `sets.ts` pulled
 * the whole authoring graph — `ai/generate`, `ai/verify`, `ai/provider`,
 * every template — into the module record of a page whose job is to show a
 * stranger eight problems. `SetConfig` comes back as a type-only import, which
 * is erased, so nothing here reaches the generator at runtime.
 */
import { createServiceClient } from "@/lib/supabase/service";
import type {
  AuthoredPlot,
  GraphResponseKind,
  ProblemFormat,
  ProblemStyle,
  SanitizedProblem,
} from "@/lib/ai/schemas";
import type { SetConfig } from "@/lib/sets";

export type SetMeta = {
  id: string;
  title: string;
  share_code: string;
  config: SetConfig;
  created_at: string;
};

type ItemRow = {
  position: number;
  problems: {
    id: string;
    style: ProblemStyle;
    format: ProblemFormat;
    difficulty: number;
    content: {
      statement_latex: string;
      hint: string | null;
      choices?: { id: string; latex: string }[];
      blanks_count?: number;
      items?: { id: string; latex: string }[];
      left?: { id: string; latex: string }[];
      right?: { id: string; latex: string }[];
      parts?: { label: string; prompt_latex: string }[];
      plot?: AuthoredPlot;
      response_kind?: GraphResponseKind;
      sketch_kind?: string;
    };
    topics: { title: string } | null;
  } | null;
};

/**
 * The one place a stored problem becomes something a client may see.
 *
 * It reads only from `content`; `answer` and `explanation` are never selected,
 * so no caller can leak them by forgetting to strip a field. Shared by the
 * owner's view and the share-link preview, which is why it takes rows rather
 * than a set id — the entitlement question is the caller's to answer.
 */
export function sanitizeItems(items: unknown): SanitizedProblem[] {
  return ((items ?? []) as unknown as ItemRow[])
    .filter((i) => i.problems)
    .map((i) => ({
      id: i.problems!.id,
      position: i.position,
      style: i.problems!.style,
      format: i.problems!.format,
      difficulty: i.problems!.difficulty,
      statement_latex: i.problems!.content.statement_latex,
      hint: i.problems!.content.hint,
      choices: i.problems!.content.choices,
      blanks_count: i.problems!.content.blanks_count,
      items: i.problems!.content.items,
      left: i.problems!.content.left,
      right: i.problems!.content.right,
      parts: i.problems!.content.parts,
      plot: i.problems!.content.plot,
      response_kind: i.problems!.content.response_kind,
      sketch_kind: i.problems!.content.sketch_kind,
      topic_title: i.problems!.topics?.title,
    }));
}

export const ITEM_SELECT =
  "position, problems(id, style, format, difficulty, content, topics(title))";

/** Load a set with sanitized problems (answers stripped) after verifying ownership. */
export async function loadSetForUser(
  setId: string,
  userId: string
): Promise<{ set: SetMeta; problems: SanitizedProblem[] } | null> {
  const db = createServiceClient();
  const { data: set } = await db
    .from("problem_sets")
    .select("id, title, share_code, config, created_at, owner_id")
    .eq("id", setId)
    .single();
  if (!set || set.owner_id !== userId) return null;

  const { data: items } = await db
    .from("problem_set_items")
    .select(ITEM_SELECT)
    .eq("set_id", setId)
    .order("position");

  return {
    set: {
      id: set.id,
      title: set.title,
      share_code: set.share_code,
      config: set.config as SetConfig,
      created_at: set.created_at,
    },
    problems: sanitizeItems(items),
  };
}
