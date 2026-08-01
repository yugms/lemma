"use client";

/**
 * Replaces the whole document when the root layout itself fails, so it can't
 * rely on any of the app's fonts, tokens or stylesheets — everything here is
 * inline on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#faf7f0",
          color: "#17130f",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: "30rem" }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="#7a1f2b" aria-hidden>
            <path d="M3 3h8.5v8.5H21V21H3V3Z" />
            <path d="M14.5 3H21v6.5h-6.5V3Z" opacity="0.45" />
          </svg>
          <h1
            style={{
              fontFamily: "ui-serif, Georgia, serif",
              fontSize: "2.25rem",
              fontWeight: 400,
              letterSpacing: "-0.02em",
              margin: "1.5rem 0 0",
            }}
          >
            lemma hit an error.
          </h1>
          <p style={{ color: "#5c5449", lineHeight: 1.7, marginTop: "1rem" }}>
            Something failed before the app could start. Reloading usually
            clears it.
          </p>
          {error.digest && (
            <p style={{ color: "#6f675a", fontSize: "0.8125rem", marginTop: "1rem" }}>
              Reference {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "2rem",
              padding: "0.75rem 1.5rem",
              background: "#7a1f2b",
              color: "#fdf6f2",
              border: "none",
              borderRadius: 3,
              fontSize: "0.9375rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
