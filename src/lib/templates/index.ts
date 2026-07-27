import type { GeneratedProblem, ProblemFormat, ProblemStyle } from "@/lib/ai/schemas";
import { createRng, randomSeed } from "@/lib/rng";
import { derivativeRules } from "@/lib/templates/derivatives";
import { linearEquations } from "@/lib/templates/linear-equations";
import { linearSystems } from "@/lib/templates/linear-systems";
import { quadraticSolving } from "@/lib/templates/quadratics";
import type { Template } from "@/lib/templates/types";

export const templates: Template[] = [
  quadraticSolving,
  linearSystems,
  derivativeRules,
  linearEquations,
];

export type TemplateInstance = {
  problem: GeneratedProblem;
  templateId: string;
  seed: number;
};

/** Find templates able to serve a topic slug at the requested difficulty/style/format. */
export function templatesFor(
  topicSlug: string,
  difficulty: number,
  styles: ProblemStyle[],
  formats: ProblemFormat[]
): { template: Template; format: ProblemFormat }[] {
  if (!styles.includes("drill")) return [];
  const out: { template: Template; format: ProblemFormat }[] = [];
  for (const t of templates) {
    if (!t.topicSlugs.includes(topicSlug)) continue;
    if (difficulty < t.difficulties[0] || difficulty > t.difficulties[1]) continue;
    for (const f of t.formats) {
      if (formats.includes(f)) out.push({ template: t, format: f });
    }
  }
  return out;
}

/** Generate one deterministic instance. */
export function instantiate(
  template: Template,
  format: ProblemFormat,
  difficulty: number,
  seed = randomSeed()
): TemplateInstance {
  const rng = createRng(seed);
  const problem = template.generate(rng, difficulty, format);
  return { problem, templateId: `${template.id}#${seed}#d${difficulty}#${format}`, seed };
}
