import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Apple touch icons must be raster and opaque, so the mark gets a tile. */
export default function AppleIcon() {
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
        <svg width="104" height="104" viewBox="0 0 24 24" fill="#FAF7F0">
          <path d="M3 3h8.5v8.5H21V21H3V3Z" />
          <path d="M14.5 3H21v6.5h-6.5V3Z" opacity="0.5" />
        </svg>
      </div>
    ),
    size
  );
}
