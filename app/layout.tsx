import type { Metadata } from "next";
import "./globals.css";

const SITE = "https://orca-siamakk2-8490s-projects.vercel.app";
const TITLE = "K2 Investment Parcel Finder — California Land Feasibility";
const DESC = "Type any California address and get an investor-grade land feasibility report in under two minutes — what you can build, what could stop the deal, and whether it's worth it. Zoning, flood, fire, and AI analysis with a downloadable PDF.";

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
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (<html lang="en"><body>{children}</body></html>);
}
