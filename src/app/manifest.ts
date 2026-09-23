import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sold",
    short_name: "Sold",
    description:
      "Take the picture. Sold prices it against real listings, posts it, and handles the buyers — nothing goes live without a real listing URL.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf8f3",
    theme_color: "#2f5233",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
