import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Check } from "lucide-react";
import { getCurrentUser, toHeaderUser } from "@/lib/auth-server";
import { describeSignInError } from "@/lib/auth-errors";
import { SignInPanel } from "@/components/sign-in-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in with Google to keep your practice history across devices. Work you did as a guest comes with you.",
};

/** Same guard the callback applies — a `next` off this origin is dropped. */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const [params, authUser] = await Promise.all([searchParams, getCurrentUser()]);
  const user = toHeaderUser(authUser);
  const next = safeNext(params.next);

  if (user && !user.isGuest) {
    return (
      <div className="mx-auto max-w-xl">
        <p className="eyebrow eyebrow-accent">Account</p>
        <h1 className="display mt-5 text-title">You&apos;re already signed in.</h1>
        <p className="mt-6 flex items-center gap-2 text-prose text-muted">
          <Check className="h-4 w-4 shrink-0 text-ok" aria-hidden />
          Signed in as {user.name ?? "your Google account"}.
        </p>
        <Link
          href="/build"
          transitionTypes={["nav-forward"]}
          className="btn btn-accent btn-lg mt-9"
        >
          Build a set
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <p className="eyebrow eyebrow-accent">Account</p>
      <h1 className="display mt-5 text-title">Sign in to keep your history.</h1>
      <p className="mt-6 text-prose text-muted">
        {user?.isGuest
          ? "You're working as a guest right now. Signing in with Google keeps the sets and answers you already have, and adds them to the same account on your other devices."
          : "Signing in with Google keeps your sets and answers across devices, unlocks Review and Stats, and raises the daily build limit from 5 sets to 20."}
      </p>

      <div className="mt-10">
        {/* Remounts when the callback comes back with a different code, so the
            panel's own cleared-error state can't outlive the URL that set it. */}
        <SignInPanel
          key={params.error ?? "none"}
          next={next}
          initialError={params.error ? describeSignInError(params.error) : null}
        />
      </div>

      <p className="mono-meta mt-8">
        {user?.isGuest ? (
          <>
            Nothing is lost either way — your guest progress lives in this
            browser&apos;s session.{" "}
            <Link href={next} className="underline underline-offset-4 hover:text-accent">
              Continue as a guest
            </Link>
          </>
        ) : (
          <>
            No account needed to build a set.{" "}
            <Link href="/build" className="underline underline-offset-4 hover:text-accent">
              Continue as a guest
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
