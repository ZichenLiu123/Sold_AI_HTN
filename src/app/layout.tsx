import type { Metadata, Viewport } from "next";
import { DM_Sans, Fraunces, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { SoldMark } from "@/components/SoldMark";

const serif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument",
});

const logo = Fraunces({
  subsets: ["latin"],
  style: "italic",
  weight: "500",
  variable: "--font-fraunces",
});

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm",
});

const mono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "Sold",
  description: "Photograph it. Agents list it and talk to the buyer.",
  applicationName: "Sold",
  appleWebApp: {
    capable: true,
    title: "Sold",
    statusBarStyle: "black-translucent",
  },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#efe4d4",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${serif.variable} ${logo.variable} ${sans.variable} ${mono.variable} font-sans antialiased`}
      >
        <Shell brand={<SoldMark />}>{children}</Shell>
      </body>
    </html>
  );
}
