import type { Metadata } from "next";
import { IBM_Plex_Mono, Libre_Franklin } from "next/font/google";

import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme";

// Text and figures are deliberately split. Libre Franklin has no `tnum` feature
// and proportional digits, so every numeric column would jitter as values
// change; Plex Mono is genuinely tabular. Both are OFL.
const libreFranklin = Libre_Franklin({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-libre-franklin",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  // The league is the product; the page is the page. Same split the app bar
  // makes on screen, so a browser tab reads "Compare · Noble Family Football"
  // rather than naming one screen and never the app.
  title: {
    default: "Noble Family Football",
    template: "%s · Noble Family Football",
  },
  description: "Every NFL week scored in this league's terms.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${libreFranklin.variable} ${plexMono.variable}`}
      // The theme is applied by the script below before paint, which mutates
      // this element. React would otherwise report the server markup and the
      // hydrated DOM as mismatched — the mismatch is the feature working.
      suppressHydrationWarning
    >
      <head>
        {/* Blocking on purpose. A stored preference read after render is a
            white flash on every navigation for anyone in dark mode. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
