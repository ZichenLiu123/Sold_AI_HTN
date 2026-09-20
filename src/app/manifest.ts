import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sold",
    short_name: "Sold",
    description: "Snap a photo. Agents write it, price it, post it, and answer the buyer.",
    start_url: "/",
    display: "standalone",
    background_color: "#efe4d4",
    theme_color: "#c5281c",
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
