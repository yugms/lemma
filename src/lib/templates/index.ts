import type { GeneratedProblem, ProblemFormat, ProblemStyle } from "@/lib/ai/schemas";
import { createRng, randomSeed } from "@/lib/rng";
import { derivativeRules } from "@/lib/templates/derivatives";
import { linearEquations } from "@/lib/templates/linear-equations";
import { linearSystems } from "@/lib/templates/linear-systems";
import { quadraticSolving } from "@/lib/templates/quadratics";
import {
  fractionArithmetic,
  integerOperations,
  orderOfOperations,
  percentChange,
} from "@/lib/templates/arithmetic";
import {
  areaPerimeter,
  distanceMidpoint,
  exponentRules,
  pythagorean,
  slopeIntercept,
} from "@/lib/templates/algebra-basics";
import {
  antiderivatives,
  centerSpread,
  simpleProbability,
} from "@/lib/templates/stats-calc";
import type { Template } from "@/lib/templates/types";

/**
 * Registration is the only wiring a template needs — and it is also what
 * enrols it in the structural test that runs every declared difficulty and
 * format across 25 seeds.
 */
export const templates: Template[] = [
  quadraticSolving,
  linearSystems,
  derivativeRules,
  linearEquations,
  // Foundations
  integerOperations,
  orderOfOperations,
  fractionArithmetic,
  percentChange,
  // Algebra 1 and geometry
  exponentRules,
  slopeIntercept,
  pythagorean,
  areaPerimeter,
  distanceMidpoint,
  // Statistics and calculus
  centerSpread,
  simpleProbability,
  antiderivatives,
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
