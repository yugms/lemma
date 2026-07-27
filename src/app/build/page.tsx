import { loadCatalog } from "@/lib/catalog";
import { BuilderForm } from "@/components/builder/builder-form";

export const dynamic = "force-dynamic";

export default async function BuildPage() {
  const catalog = await loadCatalog();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Build a problem set</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Pick your topics and how you want to practice. Generation takes up to a minute or two —
          every problem is checked before it reaches you.
        </p>
      </div>
      <BuilderForm catalog={catalog} />
    </div>
  );
}
