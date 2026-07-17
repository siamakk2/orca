import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orca — Parcel & Zoning Feasibility",
  description:
    "Instant parcel boundaries, buildable envelopes, and municipal zoning answers for real-estate brokers. Los Angeles & Napa.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
