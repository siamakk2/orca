import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Neighbourhood context from public federal and city sources.
   Every source degrades independently — one being down never blanks the section. */

const ACS_KEY = process.env.CENSUS_API_KEY;

// ACS 5-year variables. Names are stable across vintages.
const VARS: [string, string, "money" | "int" | "raw"][] = [
  ["B19013_001E", "Median household income", "money"],
  ["B25077_001E", "Median home value", "money"],
  ["B25064_001E", "Median gross rent", "money"],
  ["B01003_001E", "Population (tract)", "int"],
  ["B25003_002E", "Owner-occupied homes", "int"],
  ["B25003_001E", "Occupied homes", "int"],
  ["B15003_022E", "Adults with a bachelor's", "int"],
  ["B08303_001E", "Commuters", "int"],
];

async function census(lat: number, lon: number) {
  const u = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates?" +
    new URLSearchParams({ x: String(lon), y: String(lat), benchmark: "Public_AR_Current", vintage: "Current_Current", format: "json" });
  const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("geocoder " + r.status);
  const d = await r.json();
  const g = d?.result?.geographies || {};
  const tract = (g["Census Tracts"] || [])[0];
  const county = (g["Counties"] || [])[0];
  if (!tract) throw new Error("no tract");
  return {
    state: String(tract.STATE), county: String(tract.COUNTY), tract: String(tract.TRACT),
    tractName: tract.NAME || null, countyName: county?.NAME || null,
  };
}

async function acs(fips: { state: string; county: string; tract: string }) {
  if (!ACS_KEY) return { needsKey: true as const };
  const get = VARS.map(v => v[0]).join(",");
  const u = `https://api.census.gov/data/2023/acs/acs5?` + new URLSearchParams({
    get: `NAME,${get}`, for: `tract:${fips.tract}`, in: `state:${fips.state} county:${fips.county}`, key: ACS_KEY,
  });
  const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("acs " + r.status);
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("acs shape");
  const head: string[] = rows[0], row: string[] = rows[1];
  const at = (code: string) => { const i = head.indexOf(code); const v = i >= 0 ? Number(row[i]) : NaN; return Number.isFinite(v) && v >= 0 ? v : null; };

  const owner = at("B25003_002E"), occ = at("B25003_001E");
  const out: { label: string; value: string }[] = [];
  for (const [code, label, kind] of VARS) {
    if (code === "B25003_002E" || code === "B25003_001E" || code === "B15003_022E" || code === "B08303_001E") continue;
    const v = at(code);
    if (v == null) continue;
    out.push({ label, value: kind === "money" ? "$" + v.toLocaleString() : v.toLocaleString() });
  }
  if (owner != null && occ) out.push({ label: "Owner-occupied", value: Math.round((owner / occ) * 100) + "% of homes" });
  return { needsKey: false as const, rows: out };
}

// City of Los Angeles community plan area — the planning geography that governs local policy.
async function communityPlan(lat: number, lon: number) {
  const u = "https://services5.arcgis.com/7nsPwEMP38bSkCjy/ArcGIS/rest/services/Community_Plan_Areas/FeatureServer/0/query?" +
    new URLSearchParams({
      geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
      outFields: "*", returnGeometry: "false", f: "json",
    });
  const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(13000) });
  if (!r.ok) return null;
  const d = await r.json();
  const a = d?.features?.[0]?.attributes;
  if (!a) return null;
  for (const k of Object.keys(a)) {
    if (/name|cpa|plan|area/i.test(k) && a[k] && String(a[k]).trim() && !/^\d+$/.test(String(a[k]))) return String(a[k]).trim();
  }
  return null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = parseFloat(sp.get("lat") || ""), lon = parseFloat(sp.get("lon") || "");
  if (Number.isNaN(lat) || Number.isNaN(lon)) return NextResponse.json({ status: "error", message: "lat/lon required" }, { status: 400 });

  const out: any = { status: "ok", sources: [] as string[] };

  try {
    const fips = await census(lat, lon);
    out.tract = fips.tractName ? `Tract ${fips.tractName}` : `Tract ${fips.tract}`;
    out.countyName = fips.countyName;
    out.sources.push("U.S. Census Bureau");
    try {
      const a = await acs(fips);
      if ("needsKey" in a && a.needsKey) out.acsNeedsKey = true;
      else if (!a.needsKey) { out.demographics = a.rows; out.sources.push("ACS 5-year (2023)"); }
    } catch { out.demographicsError = true; }
  } catch { out.tractError = true; }

  try {
    const cp = await communityPlan(lat, lon);
    if (cp) { out.communityPlan = cp; out.sources.push("City of LA Planning"); }
  } catch { /* not in the City of LA, or layer down */ }

  return NextResponse.json(out);
}
