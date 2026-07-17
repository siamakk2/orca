import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-off discovery helper: enumerate a county GIS server and probe candidate
// parcel layers with a known in-county point. Remove after Napa is pinned.
const NAPA_ROOTS = [
  "https://gis.napa.ca.gov/arcgis/rest/services",
  "https://gis.napacounty.gov/arcgis/rest/services",
  "https://services.arcgis.com/campru9AeDPQVGuP/arcgis/rest/services", // common Napa hosted org (probe)
];

// A point in the City of Napa / unincorporated fringe for intersect tests
const NAPA_PT = { x: -122.2869, y: 38.2975 };

type Json = Record<string, unknown>;

async function j(url: string, ms = 20000): Promise<Json | null> {
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(ms) });
    if (!r.ok) return { __http: r.status, __url: url };
    return await r.json();
  } catch (e) {
    return { __err: String((e as Error)?.message || e), __url: url };
  }
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") || "roots";
  const out: Json = {};

  if (mode === "roots") {
    for (const root of NAPA_ROOTS) {
      out[root] = await j(`${root}?f=json`);
    }
    return NextResponse.json(out, { status: 200 });
  }

  // mode=folder&root=...  -> list a specific folder/services
  if (mode === "folder") {
    const root = req.nextUrl.searchParams.get("root") || NAPA_ROOTS[0];
    out.root = root;
    out.listing = await j(`${root}?f=json`);
    return NextResponse.json(out, { status: 200 });
  }

  // mode=probe&layer=<full layer query url base>  -> intersect test at NAPA_PT
  if (mode === "probe") {
    const layer = req.nextUrl.searchParams.get("layer");
    if (!layer) return NextResponse.json({ error: "layer required" }, { status: 400 });
    const params = new URLSearchParams({
      geometry: JSON.stringify({ x: NAPA_PT.x, y: NAPA_PT.y, spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      outSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "*",
      returnGeometry: "false",
      f: "json",
    });
    out.layer = layer;
    out.result = await j(`${layer}/query?${params.toString()}`);
    return NextResponse.json(out, { status: 200 });
  }

  return NextResponse.json({ error: "unknown mode" }, { status: 400 });
}
