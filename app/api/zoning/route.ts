import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = { address?: string; county?: string; apn?: string; acreage?: number; zoning?: string | null; zoneDesc?: string | null; lat?: number; lon?: number; flood?: string | null; fire?: string | null; williamson?: string | null; terrain?: string | null };

const DISCLAIMER =
  "AI-generated from public planning sources. Zoning, overlays, and development standards change and vary by exact parcel — confirm every figure with the jurisdiction's planning department before relying on it for an investment decision.";

export async function POST(req: NextRequest) {
  const d: Payload = await req.json().catch(() => ({}));
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ enabled: false });

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const loc = `${d.address ? d.address + ", " : ""}${d.county || ""} County, California`;
  const zoneHint = d.zoning ? `The parcel's zoning code appears to be "${d.zoning}"${d.zoneDesc ? ` (${d.zoneDesc})` : ""}. Verify this and interpret it.` : `The zoning code is not yet known — determine the most likely zoning designation for this location from the jurisdiction's zoning map or general plan.`;
  const specs: string[] = [];
  if (Number.isFinite(d.lat) && Number.isFinite(d.lon)) specs.push(`coordinates ${d.lat!.toFixed(5)}, ${d.lon!.toFixed(5)}`);
  if (d.flood) specs.push(`FEMA flood: ${d.flood}`);
  if (d.fire) specs.push(`fire hazard severity: ${d.fire}`);
  if (d.williamson) specs.push(`Williamson Act: ${d.williamson}`);
  if (d.terrain) specs.push(`terrain: ${d.terrain}`);
  const specLine = specs.length ? `\nKNOWN CURRENT SPECIFICATIONS (from county/federal layers — treat as ground truth and reason from them): ${specs.join("; ")}.` : "";

  const prompt =
`You are a California land-use and entitlements analyst advising a land investor on a specific parcel. Use web search to research the ACTUAL zoning ordinance, general plan, and development standards that govern this parcel, then produce a grounded, honest feasibility read.

PARCEL: ${loc}${d.apn ? ` (APN ${d.apn})` : ""}${d.acreage ? `, approximately ${d.acreage} acres` : ""}.
${zoneHint}${specLine}

First determine the JURISDICTION (incorporated city vs. county unincorporated) because that controls which code applies. Then search that jurisdiction's zoning code / municipal code / general plan for the governing zone. Also account for California statewide law that overrides local zoning where relevant (ADU/JADU law, SB 9 lot splits & duplexes, density bonus law, SB 35/SB 423 streamlining, Williamson Act, Coastal Act, VHFHSZ/WUI fire rules).

Be rigorous and honest:
- Only state standards (setbacks, height, density, min lot size, FAR, coverage) you can actually find in a source. If a number isn't found, say "not confirmed" rather than inventing it.
- Distinguish what is allowed BY RIGHT (ministerial) from what needs a discretionary permit (CUP, variance, rezone) or CEQA review.
- Call out anything that could STOP or delay a deal (overlays, hazard zones, contracts, moratoria, access/utility/septic limits on rural land).
- Note real UPSIDE (ADUs, SB 9 splits, density bonus, upzoning in the general plan).

Respond with ONLY a JSON object — no prose, no markdown fences — matching exactly:
{
 "jurisdiction": "e.g. City of Napa | Napa County (unincorporated)",
 "zone": "zoning designation + short name, or 'Not confirmed'",
 "summary": "2-3 sentence plain-language read of what can realistically be built here",
 "permittedUses": ["by-right / primary permitted uses, short phrases"],
 "standards": [{"label":"Max density / units","value":"..."},{"label":"Min lot size","value":"..."},{"label":"Max height","value":"..."},{"label":"Setbacks (F/S/R)","value":"..."},{"label":"Max lot coverage / FAR","value":"..."}],
 "adu": "what ADU/JADU rules allow here in 1-2 sentences",
 "opportunities": "concrete upside plays (SB9, density bonus, ADUs, GP upzoning) in 1-2 sentences, or 'Limited' ",
 "flags": ["specific things that could stop or delay a deal"],
 "process": "entitlement path in 1-2 sentences: ministerial vs discretionary, likely CEQA, rough timeline if known",
 "confidence": "high | medium | low — how well sources pinned the actual governing zone"
}
Keep arrays to 3-6 items. If you genuinely cannot identify the jurisdiction or zone, set confidence "low" and say so in summary rather than guessing specifics.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      }),
      signal: AbortSignal.timeout(55000),
    });
    if (!r.ok) return NextResponse.json({ enabled: true, report: null, error: `API ${r.status}`, disclaimer: DISCLAIMER });
    const j = await r.json();
    const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    const sources = new Set<string>();
    (j.content || []).forEach((b: any) => {
      (b.citations || []).forEach((c: any) => { try { if (c.url) sources.add(new URL(c.url).hostname.replace(/^www\./, "")); } catch {} });
    });

    // extract the JSON object from the model's final text
    let report: any = null;
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { report = JSON.parse(m[0]); } catch {} }
    if (!report) return NextResponse.json({ enabled: true, report: null, raw: text.slice(0, 500), disclaimer: DISCLAIMER });

    return NextResponse.json({ enabled: true, report, sources: [...sources].slice(0, 6), disclaimer: DISCLAIMER });
  } catch (e: any) {
    return NextResponse.json({ enabled: true, report: null, error: String(e?.message || e), disclaimer: DISCLAIMER });
  }
}
