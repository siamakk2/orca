import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "K2 Investment — Parcel Feasibility",
  description: "K2 Investment — instant parcel feasibility, zoning, hazards, and buildability for California real estate.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (<html lang="en"><body>{children}</body></html>);
}
