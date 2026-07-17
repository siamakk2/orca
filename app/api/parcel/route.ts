import { NextRequest, NextResponse } from "next/server";
import area from "@turf/area";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Source = { queryUrl: string; apnFields: string[]; addressFields: string[] };
type County = {
  slug: string;
  label: string;
  fips: string;
  bbox: [number, number, number, number];
  sources: Source[];
};

const COUNTIES: County[] = [
  {
    slug: "los_angeles",
    label: "Los Angeles",
    fips: "06037",
    bbox: [-118.95, 33.7, -117.64, 34.82],
    sources: [
      {
        queryUrl:
          "https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0/query",
        apnFields: ["AIN", "APN"],
        addressFields: ["SitusFullAddress", "SitusAddress"],
      },
      {
        queryUrl:
          "https://services3.arcgis.com/GVgbJbqm8hXASVYi/arcgis/rest/services/LA_County_Parcels/FeatureServer/0/query",
        apnFields: ["APN", "AIN"],
        addressFields: ["SitusAddress", "SitusFullAddress"],
      },
    ],
  },
  {
    slug: "napa",
    label: "Napa",
    fips: "06055",
    bbox: [-122.65, 38.15, -122.06, 38.87],
    sources: [
      {
        queryUrl:
          "https://gis.napacounty.gov/arcgis/rest/services/Hosted/Parcels_Public/FeatureServer/0/query",
        apnFields: ["asmtwithdash", "asmt"],
        addressFields: ["streetaddr"],
      },
    ],
  },
];

function countyBySlug(slug: string | null): County | null {
  return COUNTIES.find((c) => c.slug === slug) || null;
}

function routeCounty(lon: number, lat: number): County | null {
  for (const c of COUNTIES) {
    const [w, s, e, n] = c.bbox;
    if (lon >= w && lon <= e && lat >= s && lat <= n) return c;
  }
  return null;
}

function ringIsCW(ring: number[][]): boolean {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += (x2 - x1) * (y2 + y1);
  }
  return sum > 0;
}

function esriRingsToGeoJSON(rings: number[][][]) {
  const outers = rings.filter(ringIsCW);
  const holes = rings.filter((r) => !ringIsCW(r));
  const base = outers.length ? outers : rings;
  const polys = base.map((o) => [o]);
  for (const h of holes) polys[0]?.push(h);
  return polys.length === 1
    ? { type: "Polygon", coordinates: polys[0] }
    : { type: "MultiPolygon", coordinates: polys };
}

function firstPresent(attrs: Record<string, unknown>, names: string[]): string | null {
  for (const n of names) {
    const v = attrs?.[n];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

type Rec = { apn: string | null; address: string | null; geometry: unknown };

function recFromFeature(feat: any, src: Source): Rec | null {
  if (!feat?.geometry?.rings) return null;
  return {
    apn: firstPresent(feat.attributes || {}, src.apnFields),
    address: firstPresent(feat.attributes || {}, src.addressFields),
    geometry: esriRingsToGeoJSON(feat.geometry.rings),
  };
}

async function runQuery(src: Source, extra: Record<string, string>): Promise<any> {
  const params = new URLSearchParams({
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
    ...extra,
  });
  const res = await fetch(`${src.queryUrl}?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GIS HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error?.message || "GIS rejected query");
  return data;
}

async function queryByPoint(src: Source, lon: number, lat: number): Promise<Rec | null> {
  const data = await runQuery(src, {
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
  });
  return recFromFeature(data.features?.[0], src);
}

async function queryByWhere(src: Source, where: string): Promise<Rec | null> {
  const data = await runQuery(src, { where, resultRecordCount: "1" });
  return recFromFeature(data.features?.[0], src);
}

const STREET_SUFFIXES = new Set([
  "RD", "ROAD", "ST", "STREET", "AVE", "AVENUE", "BLVD", "BOULEVARD", "DR", "DRIVE",
  "LN", "LANE", "WAY", "CT", "COURT", "PL", "PLACE", "CIR", "CIRCLE", "TER", "TERRACE",
  "HWY", "HIGHWAY", "PKWY", "PARKWAY", "TRL", "TRAIL", "N", "S", "E", "W",
]);

function looksLikeApn(q: string): boolean {
  const t = q.trim();
  return /^[0-9][0-9\- ]{4,}[0-9]$/.test(t) && /[0-9].*[0-9].*[0-9]/.test(t);
}

function apnWhere(src: Source, q: string): string {
  const raw = q.trim().toUpperCase().replace(/'/g, "''");
  const digits = raw.replace(/[^0-9]/g, "");
  const clauses: string[] = [];
  for (const f of src.apnFields) {
    clauses.push(`${f}='${raw}'`);
    if (digits && digits !== raw) clauses.push(`${f}='${digits}'`);
  }
  return clauses.join(" OR ");
}

function addressWhere(src: Source, q: string): string | null {
  const up = q.trim().toUpperCase().replace(/'/g, "''");
  const tokens = up.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  let num = "";
  if (/^\d+[A-Z]?$/.test(tokens[0])) num = tokens.shift() as string;
  const streetTokens = tokens.filter((t) => !STREET_SUFFIXES.has(t));
  if (!streetTokens.length && !num) return null;
  const pattern = (num ? num + "%" : "%") + streetTokens.join("%") + "%";
  const clauses = src.addressFields.map((f) => `UPPER(${f}) LIKE '${pattern}'`);
  return clauses.length ? clauses.join(" OR ") : null;
}

function acresOf(geometry: unknown): number {
  const acres = area(geometry as GeoJSON.Geometry) / 4046.8564224;
  return Math.round(acres * 1000) / 1000;
}

function okResponse(county: County, rec: Rec, match: string) {
  return NextResponse.json({
    status: "ok",
    match,
    county: county.slug,
    label: county.label,
    fips: county.fips,
    apn: rec.apn || "—",
    address: rec.address || "",
    acreage: acresOf(rec.geometry),
    geometry: rec.geometry,
  });
}

// --- geocode fallback (only used when no parcel record matches) ---
async function geocode(q: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const url =
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" +
      new URLSearchParams({ address: q, benchmark: "Public_AR_Current", format: "json" });
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const d = await r.json();
      const m = d?.result?.addressMatches?.[0];
      if (m?.coordinates) return { lat: m.coordinates.y, lon: m.coordinates.x };
    }
  } catch {}
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({ q, format: "json", limit: "1", countrycodes: "us" });
    const r = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Orca-Parcel-Tool/1.0" },
    });
    if (r.ok) {
      const d = await r.json();
      const m = Array.isArray(d) ? d[0] : null;
      if (m) return { lat: parseFloat(m.lat), lon: parseFloat(m.lon) };
    }
  } catch {}
  return null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim();

  // ---- Text search mode (address or APN) ----
  if (q) {
    const county =
      countyBySlug(sp.get("county")) || COUNTIES[0];
    const isApn = looksLikeApn(q);

    // 1) Exact record match against the county parcel layer.
    for (const src of county.sources) {
      try {
        const where = isApn ? apnWhere(src, q) : addressWhere(src, q);
        if (!where) continue;
        const rec = await queryByWhere(src, where);
        if (rec) return okResponse(county, rec, isApn ? "apn" : "address");
      } catch {
        // invalid field / server hiccup -> try next source, then geocode
      }
    }

    // 2) Fallback: geocode the text, then point-lookup (approximate).
    const geo = await geocode(
      /CA\b|California|County/i.test(q) ? q : `${q}, ${county.label} County, CA`
    );
    if (geo) {
      const gc = routeCounty(geo.lon, geo.lat) || county;
      for (const src of gc.sources) {
        try {
          const rec = await queryByPoint(src, geo.lon, geo.lat);
          if (rec) return okResponse(gc, rec, "approximate");
        } catch {}
      }
    }

    return NextResponse.json({
      status: "not_found",
      message: `No parcel found for "${q}". Try the full street address, an APN, or click the parcel on the map.`,
    });
  }

  // ---- Point mode (map clicks) ----
  const lat = parseFloat(sp.get("lat") || "");
  const lon = parseFloat(sp.get("lon") || "");
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return NextResponse.json(
      { status: "error", message: "Provide q (address/APN) or lat & lon." },
      { status: 400 }
    );
  }
  const county = routeCounty(lon, lat);
  if (!county) {
    return NextResponse.json({
      status: "out_of_area",
      message: "That point is outside Los Angeles and Napa counties.",
    });
  }
  let lastErr: unknown = null;
  for (const src of county.sources) {
    try {
      const rec = await queryByPoint(src, lon, lat);
      if (rec) return okResponse(county, rec, "point");
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) {
    return NextResponse.json(
      { status: "error", message: String((lastErr as Error)?.message || lastErr) },
      { status: 502 }
    );
  }
  return NextResponse.json({ status: "not_found", message: "No parcel found at that location." });
}
