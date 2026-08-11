import { ImageResponse } from "next/og";

/**
 * The home-screen icon, at whatever size the manifest asked for.
 *
 * Declared `maskable`, which is a promise about the artwork rather than a
 * flag: the platform crops it to its own shape — a circle on one launcher, a
 * squircle on the next — and only the middle 80% is guaranteed to survive.
 * So the mark is drawn at 45% of the tile rather than filling it. An icon
 * that ignores this is not rejected; it is silently clipped, and on Android
 * an icon that fails validation is replaced by a screenshot of the page.
 *
 * Opaque for the same reason `apple-icon.tsx` is: a masked icon has no
 * transparency to fall back on.
 */
export function appIcon(size: number) {
  const mark = Math.round(size * 0.45);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#7A1F2B",
        }}
      >
        <svg width={mark} height={mark} viewBox="0 0 24 24" fill="#FAF7F0">
          <path d="M3 3h8.5v8.5H21V21H3V3Z" />
          <path d="M14.5 3H21v6.5h-6.5V3Z" opacity="0.5" />
        </svg>
      </div>
    ),
    { width: size, height: size }
  );
}
