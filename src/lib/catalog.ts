import { createClient } from "@/lib/supabase/server";

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
