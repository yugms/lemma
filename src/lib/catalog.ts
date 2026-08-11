import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { TopicInfo } from "@/lib/ai/generate";

export type CatalogTopic = {
  id: string;
  slug: string;
  title: string;
  supports_templates: boolean;
};
export type CatalogUnit = { id: string; slug: string; title: string; topics: CatalogTopic[] };
export type CatalogCourse = { id: string; slug: string; title: string; description: string | null; units: CatalogUnit[] };

export async function loadCatalog(): Promise<CatalogCourse[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .select(
      "id, slug, title, description, sort_order, units(id, slug, title, sort_order, topics(id, slug, title, supports_templates, sort_order))"
    )
    .order("sort_order");
  if (error || !data) return [];

  type Row = CatalogCourse & {
    sort_order: number;
    units: (CatalogUnit & { sort_order: number; topics: (CatalogTopic & { sort_order: number })[] })[];
  };
  return (data as unknown as Row[]).map((c) => ({
    ...c,
    units: [...c.units]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((u) => ({ ...u, topics: [...u.topics].sort((a, b) => a.sort_order - b.sort_order) })),
  }));
}

/**
 * Every topic, flattened into one ordered list.
 *
 * This is what a study material is classified against: the model is shown the
 * list with bracketed numbers and answers with those numbers, exactly as the
 * authoring prompt does for the handful of topics in a set. The order only has
 * to be stable within the one request that shows it, because the indices are
 * resolved to topic ids before anything is stored — see `normalizeDigest`.
 *
 * Read with the service client rather than the RLS-scoped one: the catalog is
 * identical for every reader, and the only caller is a route already doing
 * service-side work.
 */
export async function loadTopicIndex(): Promise<TopicInfo[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("topics")
    .select("id, title, description, sort_order, units(title, sort_order, courses(title, sort_order))");
  if (error || !data) return [];

  type Row = {
    id: string;
    title: string;
    description: string | null;
    sort_order: number;
    units: {
      title: string;
      sort_order: number;
      courses: { title: string; sort_order: number } | null;
    } | null;
  };

  const rank = (r: Row) => [r.units?.courses?.sort_order ?? 0, r.units?.sort_order ?? 0, r.sort_order];
  return (data as unknown as Row[])
    .sort((a, b) => {
      const [ac, au, at] = rank(a);
      const [bc, bu, bt] = rank(b);
      return ac - bc || au - bu || at - bt;
    })
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      unit_title: t.units?.title,
      course_title: t.units?.courses?.title,
    }));
}
