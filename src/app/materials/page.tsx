import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getCurrentUser } from "@/lib/auth-server";
import { listMaterials } from "@/lib/materials";
import { formatRelativeDate } from "@/lib/format";
import { MaterialUploader } from "@/components/materials/material-uploader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start from your material",
  description:
    "Upload a worksheet, a chapter or your notes, and get fresh problems in the same shape — at the level you were working at, or a step either side of it.",
};

export default async function MaterialsPage() {
  const user = await getCurrentUser();
  // A visitor with no session has nothing to list, and does not get one until
  // they actually upload — `ensureUser()` runs on the click, not on the page.
  const materials = user ? await listMaterials(user.id) : [];
  const ready = materials.filter((m) => m.status === "ready");

  return (
    <div className="mx-auto max-w-3xl">
      <header className="pb-10">
        <p className="eyebrow eyebrow-accent">From your material</p>
        <h1 className="display mt-5 text-title">Practise what you&apos;re actually studying</h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
          Upload a worksheet, a chapter, or a page of notes. We read it once, work out what it
          covers and how hard it is, then write fresh problems in the same shape — as many as you
          like, at the level you were working at or a step either side.
        </p>
        <p className="mono-meta mt-4">
          The file itself isn&apos;t kept — only what we worked out from it.
        </p>
      </header>

      <MaterialUploader />

      {ready.length > 0 && (
        <section className="mt-14 border-t border-line pt-9">
          <h2 className="eyebrow">Read earlier</h2>
          <ul className="mt-4 space-y-2">
            {ready.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/materials/${m.id}`}
                  className="group flex items-center gap-3 rounded-[3px] border border-line px-4 py-3 transition-colors hover:border-line-strong"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {m.digest?.title || "Untitled material"}
                  </span>
                  <span className="mono-meta shrink-0">{formatRelativeDate(m.created_at)}</span>
                  <ArrowRight
                    className="h-3.5 w-3.5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mono-meta mt-4">Build another set from any of these without re-uploading.</p>
        </section>
      )}
    </div>
  );
}
