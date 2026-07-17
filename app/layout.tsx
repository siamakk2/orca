import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Orca — Parcel & Zoning",
  description: "Parcel boundaries and zoning for Los Angeles & Napa brokers.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (<html lang="en"><body>{children}</body></html>);
}
