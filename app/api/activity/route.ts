import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = { address?: string; county?: string; apn?: string };

export async function POST(req: NextRequest) {
  const d: Payload = await req.json().catch(() => ({}));
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ enabled: false });

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const where = `${d.address ? d.address + ", " : ""}${d.county || ""} County, California`;
  const prompt =
`You are a commercial real-estate market analyst briefing a land investor. Using web search, find MAJOR real-estate and infrastructure developments — data centers, logistics/warehouse/industrial, commercial and retail projects, large residential subdivisions, and public infrastructure — that are recently announced, proposed, entitled, or under construction within roughly a few miles of ${where}.

Then write a tight 150-220 word briefing, in plain prose (no headers, no markdown), covering:
- the specific projects you found (name them and roughly where),
- the overall direction of this submarket (growth corridor, industrial buildout, built-out infill, rural/agricultural, etc.),
- and what that activity signals for land value and development demand at this location.

Be concrete and honest. If you find little nearby activity, say so directly rather than padding.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 1100,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      }),
      signal: AbortSignal.timeout(40000),
    });
    if (!r.ok) return NextResponse.json({ enabled: true, briefing: null, error: `API ${r.status}` });
    const j = await r.json();
    const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    // collect any cited source domains
    const sources = new Set<string>();
    (j.content || []).forEach((b: any) => {
      (b.citations || []).forEach((c: any) => { try { if (c.url) sources.add(new URL(c.url).hostname.replace(/^www\./, "")); } catch {} });
    });
    return NextResponse.json({ enabled: true, briefing: text || null, sources: [...sources].slice(0, 6) });
  } catch (e: any) {
    return NextResponse.json({ enabled: true, briefing: null, error: String(e?.message || e) });
  }
}
