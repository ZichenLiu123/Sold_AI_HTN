import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AuthChrome } from "@/components/AuthChrome";
import { LlmWarning } from "@/components/LlmWarning";
import { SoldMark } from "@/components/SoldMark";
import { TabBar } from "@/components/TabBar";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-grotesk",
});

const mono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "Sold — take the picture. Sold does the rest.",
  description:
    "AI agents that identify what you photographed, price it from live listings, post across Facebook, Kijiji, Karrot, OfferUp, Craigslist, Mercari, Poshmark, and eBay, and draft buyer replies — you keep the floor.",
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
  themeColor: "#ffffff",
  interactiveWidget: "resizes-visual",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body
        className={`${sans.variable} ${mono.variable} h-full font-sans antialiased`}
      >
        <div className="sold-frame flex w-full justify-center bg-paper">
          <div className="app-shell relative flex w-full flex-col overflow-hidden border-x border-line md:border-x-0">
            <svg width="0" height="0" className="absolute" aria-hidden>
              <filter id="stamp-bleed">
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.9"
                  numOctaves="2"
                  result="noise"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="noise"
                  scale="1.1"
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </filter>
            </svg>
            <header className="sold-header safe-top z-20 shrink-0 border-b border-line">
              <div className="flex h-14 items-center justify-between px-4">
                <SoldMark />
                <AuthChrome />
              </div>
              <LlmWarning />
            </header>
            <main className="sold-main flex min-h-0 flex-1 flex-col">{children}</main>
            <TabBar />
          </div>
        </div>
      </body>
    </html>
  );
}
