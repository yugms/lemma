import type { GeneratedProblem, ProblemFormat } from "@/lib/ai/schemas";
import type { Rng } from "@/lib/rng";

export interface Template {
  id: string;
  /** topics.slug values this template can serve */
  topicSlugs: string[];
  formats: ProblemFormat[];
  difficulties: [min: number, max: number];
  generate(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem;
}
