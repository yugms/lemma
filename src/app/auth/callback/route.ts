import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Rejects anything that isn't a path on this origin. `next` is attacker-shaped
 * — it survives a round trip through Google — and it is spliced straight into
 * a redirect, so a protocol-relative "//host" has to be dropped rather than
 * normalized.
 */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  // Google reports its own refusals here rather than sending a code at all,
  // and Supabase forwards its error_code the same way.
  const providerError =
    searchParams.get("error_code") ?? searchParams.get("error");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // The exchange is the last step, so its code is the most specific one
    // available — carry it rather than a generic flag.
    return NextResponse.redirect(
      `${origin}/signin?error=${encodeURIComponent(error.code ?? "unexpected_failure")}`
    );
  }

  // A user who backed out at Google's consent screen is not an error worth a
  // red banner; they land on /signin with the button still there.
  if (providerError === "access_denied") {
    return NextResponse.redirect(`${origin}/signin`);
  }

  return NextResponse.redirect(
    `${origin}/signin?error=${encodeURIComponent(providerError ?? "bad_oauth_callback")}`
  );
}
