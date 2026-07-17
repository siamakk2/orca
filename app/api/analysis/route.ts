import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = {
  address?: string; apn?: string; acreage?: number; county?: string;
  buildability?: any; risk?: any; useCode?: any; assessed?: string|null; land?: string|null;
};

/* -------- deterministic investor write-up (works with no API key) -------- */
function fallbackNarrative(d: Payload): string {
  const ac = d.acreage ?? 0;
  const b = d.buildability || {}, r = d.risk || {};
  const zone = b.code ? `${b.code}${b.name ? ` (${b.name})` : ""}` : "an unconfirmed zoning district";
  const units = b.maxUnits;
  const parts: string[] = [];

  // Development potential
  let dev = `This ${ac ? ac.toLocaleString() : "—"}-acre parcel in ${d.county || "the county"} is zoned ${zone}. `;
  if (units != null) {
    if (units <= 1) dev += `Under current density rules it supports a single dwelling by right${b.minLot ? `, since the zone's ${b.minLot} minimum makes subdivision infeasible at this size` : ""}. The realistic play here is a single estate or agricultural use plus an accessory dwelling (ADU) — not a multi-lot subdivision.`;
    else dev += `Density rules allow up to roughly ${units} dwellings, which opens a small-subdivision or multi-unit strategy worth pricing against the cost of entitlements.`;
  } else dev += `Buildable density couldn't be confirmed from the zoning layer and should be verified against the county code.`;
  if (b.use) dev += ` Primary permitted use: ${b.use.toLowerCase()}.`;
  parts.push(dev);

  // Risks
  const flags: string[] = [];
  if (r.fire && /high/i.test(r.fire.text)) flags.push(`a **${r.fire.text}** fire-hazard rating, which drives insurance cost, WUI building requirements, and defensible-space obligations`);
  if (r.flood && r.flood.level === "red") flags.push(`a mapped **flood hazard (${r.flood.text})** that will require elevation certificates and flood insurance`);
  if (r.williamson && r.williamson.level === "red") flags.push(`an active **Williamson Act contract**, which restricts development until the contract is cancelled or non-renewed — a multi-year process with penalties`);
  if (ac > 5) flags.push(`large rural acreage where **slope, access, water, and septic feasibility** typically govern what can actually be built more than zoning does`);
  if (flags.length) parts.push(`Key diligence items: ${flags.join("; ")}.`);
  else parts.push(`No major mapped hazards flagged, though slope, access, and utilities still warrant on-site confirmation.`);

  // Verdict
  const hardStops = (r.williamson?.level === "red") || (r.flood?.level === "red");
  const fireHi = r.fire && /very high/i.test(r.fire.text);
  let verdict: string;
  if (hardStops) verdict = `Bottom line: proceed only with eyes open — there's a structural constraint (${r.williamson?.level === "red" ? "Williamson Act" : "flood"}) that materially limits or delays development. Price it as raw-hold land, not a near-term build.`;
  else if (units != null && units <= 1) verdict = `Bottom line: this reads as a single-home or agricultural/estate hold${fireHi ? ", with fire hazard as the main carrying-cost and insurability risk" : ""}. Upside is scenic/lifestyle value and ADU income, not density.`;
  else verdict = `Bottom line: the density and use rules leave room for a real development play; the deal turns on entitlement cost and the hazard items above.`;
  parts.push(verdict);

  if (!d.assessed) parts.push(`Assessed value isn't published in the county's public layer for this parcel — pull it (and recent comps for the allowed use) before making an offer.`);
  return parts.join("\n\n");
}

/* -------- optional Claude-written version when a key is present -------- */
async function aiNarrative(d: Payload): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const prompt = `You are a seasoned California land-investment and development analyst advising a client whether to pursue a parcel. Using ONLY the data below, write a sharp, plain-spoken investor analysis of 180-260 words in three short paragraphs: (1) development potential given the zoning and density, (2) the key risks and diligence items that could kill or delay the deal, (3) a one-line bottom-line verdict. Be specific and honest, name unknowns, don't invent numbers. Do not use headers or markdown.\n\nPARCEL DATA:\n${JSON.stringify(d, null, 2)}`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 700, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    return text || null;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const d: Payload = await req.json().catch(() => ({}));
  const ai = await aiNarrative(d);
  if (ai) return NextResponse.json({ narrative: ai, ai: true });
  return NextResponse.json({ narrative: fallbackNarrative(d), ai: false });
}
