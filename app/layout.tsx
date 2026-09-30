import type { Metadata, Viewport } from "next";
import "./site.css";

// Root layout for the one-page proof-capture site. The previous product's
// layout (Geist fonts + Tailwind globals) is parked in legacy/voice-product-app.

// Title/description copied exactly from the design file's <head>.
export const metadata: Metadata = {
  title: "Vowwl — Catch the proof before it disappears",
  description:
    "Vowwl captures the proof your projects already generate, before it disappears, and turns it into finished success stories. Without adding work to your delivery team.",
};

// Mirrors the design's viewport meta. viewport-fit=cover lets the sticky
// top bar use env(safe-area-inset-top) on notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* IBM Plex Serif/Sans loaded from Google Fonts with the exact same
            URL as the design file, so weights/italics match 1:1. A plain
            <link> (not next/font) keeps the build free of font downloads. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
