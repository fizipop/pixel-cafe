import type { Metadata } from "next";
import "@fontsource/press-start-2p/400.css";
import "@fontsource/vt323/400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pixel Cafe — an anonymous pixel-art hangout",
  description:
    "Draw your own pixel character, walk into a cozy virtual cafe and hang out with strangers. No real names. No pressure.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
