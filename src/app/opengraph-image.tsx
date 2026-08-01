import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "lemma — math practice, generated for you";

/**
 * Static at build time. Deliberately typeset in the default face rather
 * than fetching Fraunces at build — a network dependency in the build is
 * not worth a social card's serifs.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#FAF7F0",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="46" height="46" viewBox="0 0 24 24" fill="#7A1F2B">
            <path d="M3 3h8.5v8.5H21V21H3V3Z" />
            <path d="M14.5 3H21v6.5h-6.5V3Z" opacity="0.45" />
          </svg>
          <div style={{ fontSize: 44, color: "#17130F", letterSpacing: -1.5 }}>
            lemma
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              fontSize: 96,
              lineHeight: 1.02,
              color: "#17130F",
              letterSpacing: -4,
              maxWidth: 900,
            }}
          >
            Problem sets built to order.
          </div>
          <div
            style={{
              fontSize: 30,
              lineHeight: 1.45,
              color: "#5C5449",
              maxWidth: 780,
            }}
          >
            Pick the topic, the difficulty and the style. Every problem is
            solved independently before it reaches you.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 22,
            color: "#7A1F2B",
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
        >
          <div style={{ width: 56, height: 3, background: "#7A1F2B" }} />
          Every problem independently verified
        </div>
      </div>
    ),
    size
  );
}
