import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "@/lib/env";
import { contentSecurityPolicy, newNonce } from "@/lib/csp";
import { authCookieOptions } from "@/lib/supabase/cookie-options";

export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = contentSecurityPolicy({
    nonce,
    supabaseOrigin: new URL(supabaseUrl()).origin,
    isDev: process.env.NODE_ENV === "development",
  });

  /**
   * The nonce has to travel on the *request*, not just the response: Next
   * parses the request's CSP header during render and stamps the nonce onto
   * every script it emits. Rebuilt on each call rather than captured once,
   * because `request.cookies.set` below writes through to `request.headers`,
   * and a stale copy would drop the refreshed session cookie.
   */
  const forwardedHeaders = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return headers;
  };

  let response = NextResponse.next({ request: { headers: forwardedHeaders() } });

  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: forwardedHeaders() } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
        /**
         * `headers` is the library's own no-store set, and it only arrives on
         * responses that carry a refreshed session. Forwarding it is what stops
         * a CDN or reverse proxy caching a page along with its `Set-Cookie` and
         * handing one student's session to the next visitor. It was being
         * dropped, which is the one way the token really could have leaked.
         */
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Refresh the session if expired — required for Server Components.
  await supabase.auth.getUser();

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Generated metadata images (icon/apple-icon/opengraph-image) are static
    // and carry no session, so they skip the refresh round-trip too.
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|opengraph-image|twitter-image|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
