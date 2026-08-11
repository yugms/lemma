import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
        {/* A secondary link rather than a fifth item in the header: this is
            another way to start the same thing, not another place to be. */}
        <p className="mt-6">
          <Link
            href="/materials"
            className="group inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
          >
            Or start from a worksheet, a chapter or your notes
            <ArrowRight
              className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </p>
      </header>
      <BuilderForm catalog={catalog} />
    </div>
  );
}
