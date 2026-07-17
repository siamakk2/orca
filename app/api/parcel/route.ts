import { NextRequest, NextResponse } from "next/server";
import area from "@turf/area";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Source = { queryUrl: string; apnFields: string[]; addressFields: string[] };
type County = {
  slug: string;
  label: string;
  fips: string;
  bbox: [number, number, number, number]; // W,S,E,N (4326)
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
        // LA County Assessor public parcel cache (verified live, no key)
        queryUrl:
          "https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0/query",
        apnFields: ["AIN", "APN"],
        addressFields: ["SitusFullAddress", "SitusAddress"],
      },
      {
        // Hosted FeatureServer fallback (richer attrs, predictable geometry)
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
    sources: [], // exact endpoint pending confirmation
  },
];

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
  return sum > 0; // CW => Esri exterior
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

async function querySource(src: Source, lon: number, lat: number) {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    f: "json",
  });
  const res = await fetch(`${src.queryUrl}?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GIS HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error?.message || "GIS rejected query");
  const feat = data.features?.[0];
  if (!feat?.geometry?.rings) return null;
  return {
    apn: firstPresent(feat.attributes || {}, src.apnFields),
    address: firstPresent(feat.attributes || {}, src.addressFields),
    geometry: esriRingsToGeoJSON(feat.geometry.rings),
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = parseFloat(sp.get("lat") || "");
  const lon = parseFloat(sp.get("lon") || "");
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return NextResponse.json({ status: "error", message: "lat and lon required" }, { status: 400 });
  }

  const county = routeCounty(lon, lat);
  if (!county) {
    return NextResponse.json({
      status: "out_of_area",
      message: "That point is outside Los Angeles and Napa counties.",
    });
  }
  if (county.sources.length === 0) {
    return NextResponse.json({
      status: "pending",
      county: county.slug,
      label: county.label,
      message: `${county.label} parcel service is being connected. Los Angeles is live now.`,
    });
  }

  let record: Awaited<ReturnType<typeof querySource>> = null;
  let lastErr: unknown = null;
  for (const src of county.sources) {
    try {
      record = await querySource(src, lon, lat);
      if (record) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!record) {
    if (lastErr) {
      return NextResponse.json(
        { status: "error", message: String((lastErr as Error)?.message || lastErr) },
        { status: 502 }
      );
    }
    return NextResponse.json({ status: "not_found", message: "No parcel found at that location." });
  }

  const acres = area(record.geometry as GeoJSON.Geometry) / 4046.8564224;
  return NextResponse.json({
    status: "ok",
    county: county.slug,
    label: county.label,
    fips: county.fips,
    apn: record.apn || "—",
    address: record.address || "",
    acreage: Math.round(acres * 1000) / 1000,
    geometry: record.geometry,
  });
}
