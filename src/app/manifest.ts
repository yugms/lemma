import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "lemma — math practice, generated for you",
    short_name: "lemma",
    description:
      "Build custom math problem sets by course, topic, and difficulty. Every problem is independently verified.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf7f0",
    theme_color: "#7a1f2b",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
    ],
  };
}
