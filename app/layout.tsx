import type { Metadata } from "next";
import { IBM_Plex_Mono, Libre_Franklin } from "next/font/google";

import "./globals.css";

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
  title: "Draft board",
  description: "Every NFL week scored in this league's terms.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${libreFranklin.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
