import type { Metadata } from "next";

// /tool is the application itself: a MapLibre canvas whose only crawlable text
// is the cold-start dialog, which restates the landing page. The root layout
// sets alternates.canonical to the site root, which made /tool declare / as its
// canonical — a cross-page canonical between two pages that are not duplicates.
// Google treats that as a hint and routinely ignores it when the content
// differs, which would leave a thin app shell competing with the landing page
// for the same queries.
//
// noindex keeps /tool out of the index unambiguously; follow lets link equity
// continue through it. The canonical is made self-referential rather than left
// pointing at /, because noindex combined with a canonical to a different URL
// sends Google two contradictory instructions about the same page.
//
// Metadata merges shallowly and later segments replace duplicate keys, so this
// replaces the root layout's robots and alternates for this route only.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
  alternates: { canonical: "/tool" },
};

// Returns children untouched: the tool renders a full-viewport absolutely
// positioned tree, and an extra wrapper element would change its containing
// block and stacking context.
export default function ToolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
