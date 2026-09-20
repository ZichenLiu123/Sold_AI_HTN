import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sold",
    short_name: "Sold",
    description: "Photograph something. Agents write the listing and negotiate.",
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
