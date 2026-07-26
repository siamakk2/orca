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

// Nearest points of interest from the California state GIS server — the same host that serves
// the statewide CAL FIRE layer. Field names differ per layer, so names/addresses are picked
// tolerantly rather than hardcoded.
type Poi = { url: string; name: string[]; extra: string[]; radius: number; take: number };
const POI: Record<string, Poi> = {
  schools: {
    url: "https://services.gis.ca.gov/arcgis/rest/services/Society/California_Schools/MapServer/0/query",
    name: ["School", "SCHOOL", "SchoolName", "NAME", "Name"], extra: ["City", "CITY", "EdOpsName", "Street"], radius: 3200, take: 4,
  },
  colleges: {
    url: "https://services.gis.ca.gov/arcgis/rest/services/Society/Colleges_Universities/MapServer/0/query",
    name: ["NAME", "Name", "INSTNM", "College"], extra: ["LCITY", "CITY", "City", "INST_TYPE"], radius: 8000, take: 2,
  },
  hospitals: {
    url: "https://gis.cdph.ca.gov/gisadmin/rest/services/BaseMap/HealthcareFacilitiesELMS/MapServer/0/query",
    name: ["FACNAME", "FACILITY_NAME", "NAME", "Name", "FAC_NAME", "FACILITY"], extra: ["CITY", "City", "FAC_TYPE", "TYPE", "FACTYPE"], radius: 12000, take: 3,
  },
};

const pickName = (a: any, keys: string[]) => {
  for (const k of keys) if (a?.[k] && String(a[k]).trim()) return String(a[k]).trim();
  // fall back to the first string field that looks like a name
  for (const k of Object.keys(a || {})) {
    if (/name|facname|school|instnm/i.test(k) && a[k] && String(a[k]).trim()) return String(a[k]).trim();
  }
  return null;
};

function miles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8, tr = Math.PI / 180;
  const dLat = (lat2 - lat1) * tr, dLon = (lon2 - lon1) * tr;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * tr) * Math.cos(lat2 * tr) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function nearby(kind: keyof typeof POI, lat: number, lon: number) {
  const cfg = POI[kind];
  const p = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint", inSR: "4326", outSR: "4326",
    distance: String(cfg.radius), units: "esriSRUnit_Meter",
    spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: "true",
    resultRecordCount: "50", f: "json",
  });
  const r = await fetch(`${cfg.url}?${p}`, { cache: "no-store", signal: AbortSignal.timeout(14000) });
  if (!r.ok) throw new Error(kind + " " + r.status);
  const d = await r.json();
  if (d?.error) throw new Error(d.error?.message || kind);
  const out = (d.features || []).map((f: any) => {
    const nm = pickName(f.attributes, cfg.name);
    if (!nm || !f.geometry || !Number.isFinite(f.geometry.x)) return null;
    let sub: string | null = null;
    for (const k of cfg.extra) if (f.attributes?.[k] && String(f.attributes[k]).trim()) { sub = String(f.attributes[k]).trim(); break; }
    return { name: nm, sub, mi: miles(lat, lon, f.geometry.y, f.geometry.x) };
  }).filter(Boolean) as { name: string; sub: string | null; mi: number }[];
  const seen = new Set<string>();
  return out.filter(x => { const k = x.name.toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.mi - b.mi).slice(0, cfg.take)
    .map(x => ({ name: x.name, sub: x.sub, distance: x.mi < 0.1 ? "on site" : x.mi.toFixed(1) + " mi" }));
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

  // Points of interest run in parallel; each failure is isolated to its own kind.
  const kinds = ["schools", "colleges", "hospitals"] as const;
  const results = await Promise.allSettled(kinds.map(k => nearby(k, lat, lon)));
  let anyPoi = false;
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.length) { out[kinds[i]] = r.value; anyPoi = true; }
  });
  if (anyPoi) out.sources.push("CA State Geoportal");

  return NextResponse.json(out);
}
