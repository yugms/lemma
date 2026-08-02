import Link from "next/link";
import type { Metadata } from "next";
import { Check } from "lucide-react";
import { getCurrentUser, toHeaderUser } from "@/lib/auth-server";
import { loadAccountSummary } from "@/lib/account";
import { DangerZone } from "@/components/account/danger-zone";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account" };

/**
 * The honest answer for a visitor with no session: there is genuinely nothing
 * here yet, and nothing to delete. A session is created the first time they
 * build a set, not on arrival.
 */
function NothingStored() {
  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow eyebrow-accent">Account</p>
      <h1 className="display mt-5 text-title">Nothing stored yet.</h1>
      <p className="mt-7 text-prose text-muted">
        This browser has no session, so lemma is holding no sets, no answers and no
        uploads for you. One is created the moment you build your first set — until
        then there is nothing here to manage or remove.
      </p>
      <div className="mt-9 flex flex-wrap gap-3">
        <Link href="/build" className="btn btn-accent">
          Build a set
        </Link>
        <Link href="/privacy" className="btn btn-outline">
          Read the privacy policy
        </Link>
      </div>
    </div>
  );
}

export default async function AccountPage() {
  const authUser = await getCurrentUser();
  // No session at all — a first visit, or a browser that has been cleared.
  // This used to 404, which was defensible when the only way here was your own
  // name in the header. The privacy policy now links here as the place to
  // remove your data, and a 404 at the end of that sentence reads as the
  // controls being gone rather than as there being nothing to remove.
  if (!authUser) return <NothingStored />;

  const user = toHeaderUser(authUser);
  const isGuest = Boolean(user?.isGuest);
  const summary = await loadAccountSummary(authUser.id);

  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow eyebrow-accent">Account</p>
      <h1 className="display mt-5 text-title">
        {isGuest ? "You're a guest." : "Your account."}
      </h1>

      <div className="mt-7 space-y-3">
        {isGuest ? (
          <p className="text-prose text-muted">
            Your work lives in this browser&apos;s session rather than in an account.
            Clearing your cookies would orphan it permanently —{" "}
            <Link href="/signin" className="underline underline-offset-4 hover:text-accent">
              sign in
            </Link>{" "}
            to keep it, and everything you already have comes with you.
          </p>
        ) : (
          <p className="flex items-center gap-2 text-prose text-muted">
            <Check className="h-4 w-4 shrink-0 text-ok" aria-hidden />
            Signed in as {user?.name ?? "your Google account"}.
          </p>
        )}
      </div>

      <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-line bg-line sm:grid-cols-4">
        {[
          { label: "Sets", value: summary.sets },
          { label: "Answers", value: summary.attempts },
          { label: "Sessions", value: summary.sessions },
          { label: "Scans", value: summary.scans },
        ].map((stat) => (
          <div key={stat.label} className="bg-paper px-4 py-5">
            <dt className="mono-meta">{stat.label}</dt>
            <dd className="display-md mt-1.5 text-section">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-14">
        <div className="border-b border-line pb-3">
          <h2 className="eyebrow">Removing things</h2>
        </div>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted">
          None of this is recoverable, and none of it is reversible from here.
          {summary.sets > 0 &&
            " Sets are the part worth pausing over — each one cost a slot against your daily limit to generate."}
        </p>
        <div className="mt-7">
          <DangerZone summary={summary} isGuest={isGuest} />
        </div>
      </div>
    </div>
  );
}
