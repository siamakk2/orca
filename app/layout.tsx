import type { Metadata } from "next";
import "./globals.css";

const SITE = "https://land.siamakconsulting.com";
const TITLE = "K2 Investment Parcel Finder — California Land Feasibility";
const DESC = "Type any California address and get a complete property record in under two minutes — zoning on file, FEMA flood, CAL FIRE hazard, Williamson Act, assessed value, and an AI read of what the record implies. Informational only; verify with the county.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESC,
  keywords: ["California land feasibility","parcel finder","zoning lookup","land due diligence","real estate investment","development feasibility","APN search","K2 Investment"],
  applicationName: "K2 Investment Parcel Finder",
  authors: [{ name: "K2 Investment Inc." }],
  alternates: { canonical: SITE },
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "K2 Investment Parcel Finder",
    title: TITLE,
    description: DESC,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "K2 Investment Parcel Finder — California land feasibility" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESC,
    images: ["/og-image.png"],
  },
  icons: { icon: "/k2-logo.png", apple: "/k2-logo.png" },
  // Google Search Console ownership. GSC issues one token per property and
  // accepts it either as this meta tag or as a DNS TXT record
  // "google-site-verification=<token>", so the same value covers both methods
  // for a URL-prefix property. A Domain property accepts only the DNS form.
  verification: { google: "AwboRwijDM9A4KHc7fgar3v6wgPLQ-F-0zZgEJa1Wzc" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (<html lang="en"><body>{children}</body></html>);
}
