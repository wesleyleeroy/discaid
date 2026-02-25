import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DiscAId — Autonomous AI DJ",
  description: "An intelligent, hands-off AI DJ that automatically analyzes, queues, and transitions between your tracks with professional-quality mixing.",
  keywords: ["AI DJ", "autonomous mixing", "audio analysis", "beat matching", "harmonic mixing"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
