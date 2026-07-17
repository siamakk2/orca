import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side geocoding so the browser never hits CORS and we need no API key.
// Primary: US Census onelineaddress geocoder (free, US-only, no key).
// Fallback: OpenStreetMap Nominatim (free, needs a User-Agent).

type LatLon = { lat: number; lon: number; matched: string; source: string };

async function censusGeocode(q: string): Promise<LatLon | null> {
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" +
    new URLSearchParams({
      address: q,
      benchmark: "Public_AR_Current",
      format: "json",
    });
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const data = await res.json();
  const m = data?.result?.addressMatches?.[0];
  if (!m?.coordinates) return null;
  return {
    lat: m.coordinates.y,
    lon: m.coordinates.x,
    matched: m.matchedAddress || q,
    source: "census",
  };
}

async function nominatimGeocode(q: string): Promise<LatLon | null> {
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q,
      format: "json",
      limit: "1",
      countrycodes: "us",
    });
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "Orca-Parcel-Tool/1.0 (parcel feasibility)" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const m = Array.isArray(data) ? data[0] : null;
  if (!m) return null;
  return {
    lat: parseFloat(m.lat),
    lon: parseFloat(m.lon),
    matched: m.display_name || q,
    source: "nominatim",
  };
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ status: "error", message: "Enter an address." }, { status: 400 });
  }

  let hit: LatLon | null = null;
  try {
    hit = await censusGeocode(q);
  } catch {
    hit = null;
  }
  if (!hit) {
    try {
      hit = await nominatimGeocode(q);
    } catch {
      hit = null;
    }
  }

  if (!hit) {
    return NextResponse.json({
      status: "not_found",
      message: "Couldn't find that address. Try adding city and state, or click the map instead.",
    });
  }

  return NextResponse.json({ status: "ok", ...hit });
}
