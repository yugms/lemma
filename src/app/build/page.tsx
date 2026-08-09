import type { Metadata } from "next";
import { loadCatalog } from "@/lib/catalog";
import { BuilderForm } from "@/components/builder/builder-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Build a set",
  description:
    "Pick up to six topics — from one course or across several — plus a difficulty and a style. Every problem is independently verified before it reaches you.",
};

export default async function BuildPage() {
  const catalog = await loadCatalog();
  return (
    <div className="mx-auto max-w-3xl">
      <header className="pb-10">
        <p className="eyebrow eyebrow-accent">New set</p>
        <h1 className="display mt-5 text-title">Build a problem set</h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
          Generation takes a minute or two. Every problem is solved
          independently and checked before it reaches you.
        </p>
      </header>
      <BuilderForm catalog={catalog} />
    </div>
  );
}
