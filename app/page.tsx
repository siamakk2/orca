"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type CountySlug = "los_angeles" | "napa";

const COUNTY_VIEWS: Record<
  CountySlug,
  { center: [number, number]; zoom: number; label: string; hint: string }
> = {
  los_angeles: {
    center: [-118.2437, 34.0522],
    zoom: 11,
    label: "Los Angeles",
    hint: "Los Angeles County, CA",
  },
  napa: { center: [-122.2869, 38.2975], zoom: 12, label: "Napa", hint: "Napa County, CA" },
};

// Self-contained raster basemap — no external style.json to fail. CARTO light tiles.
const RASTER_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
} as unknown as maplibregl.StyleSpecification;

type Parcel = {
  status: string;
  county?: string;
  label?: string;
  apn?: string;
  address?: string;
  acreage?: number;
  geometry?: GeoJSON.Geometry;
  message?: string;
};

export default function Home() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [county, setCounty] = useState<CountySlug>("los_angeles");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Type an address or click the map to pull a parcel.");
  const [parcel, setParcel] = useState<Parcel | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: RASTER_STYLE,
      center: COUNTY_VIEWS.los_angeles.center,
      zoom: COUNTY_VIEWS.los_angeles.zoom,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.resize();
      setMapReady(true);
      map.addSource("parcel", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "parcel-fill",
        type: "fill",
        source: "parcel",
        paint: { "fill-color": "#06b6d4", "fill-opacity": 0.28 },
      });
      map.addLayer({
        id: "parcel-line",
        type: "line",
        source: "parcel",
        paint: { "line-color": "#0e7490", "line-width": 2.5 },
      });
    });

    map.on("error", (e) => {
      // Keep the app usable even if a tile hiccups; log for diagnostics.
      console.warn("map error", e?.error?.message || e);
    });

    map.on("click", (e) => {
      void lookup(e.lngLat.lat, e.lngLat.lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drawParcel(data: Parcel) {
    const map = mapRef.current;
    const src = map?.getSource("parcel") as maplibregl.GeoJSONSource | undefined;
    if (data.status === "ok" && data.geometry && src && map) {
      src.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: data.geometry }],
      });
      const b = new maplibregl.LngLatBounds();
      const g = data.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      const rings = g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
      rings.flat().forEach((c) => b.extend(c as [number, number]));
      if (!b.isEmpty()) map.fitBounds(b, { padding: 80, maxZoom: 18 });
    } else if (src) {
      src.setData({ type: "FeatureCollection", features: [] });
    }
  }

  async function lookup(lat: number, lon: number) {
    setLoading(true);
    setParcel(null);
    setStatus("Fetching parcel…");
    try {
      const res = await fetch(`/api/parcel?lat=${lat}&lon=${lon}`);
      const data: Parcel = await res.json();
      setParcel(data);
      drawParcel(data);
      if (data.status === "ok") setStatus(`${data.label} County parcel found.`);
      else setStatus(data.message || "No parcel there.");
    } catch {
      setParcel({ status: "error", message: "Lookup failed — try again." });
      setStatus("Lookup failed — try again.");
    } finally {
      setLoading(false);
    }
  }

  async function searchAddress() {
    const q = address.trim();
    if (!q) return;
    const withRegion = /\bCA\b|California|County/i.test(q)
      ? q
      : `${q}, ${COUNTY_VIEWS[county].hint}`;
    setLoading(true);
    setParcel(null);
    setStatus("Finding address…");
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(withRegion)}`);
      const geo = await res.json();
      if (geo.status !== "ok") {
        setStatus(geo.message || "Address not found.");
        setLoading(false);
        return;
      }
      mapRef.current?.flyTo({ center: [geo.lon, geo.lat], zoom: 17 });
      await lookup(geo.lat, geo.lon);
    } catch {
      setStatus("Address lookup failed — try again.");
      setLoading(false);
    }
  }

  function switchCounty(c: CountySlug) {
    setCounty(c);
    const v = COUNTY_VIEWS[c];
    mapRef.current?.flyTo({ center: v.center, zoom: v.zoom });
  }

  return (
    <div style={{ position: "relative", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0, background: "#eef2f5" }} />

      {/* Top control bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
        {/* Brand + county */}
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-[#0f172a]/95 px-4 py-2.5 shadow-lg backdrop-blur">
          <span className="text-lg font-semibold tracking-tight text-white">Orca</span>
          <div className="flex overflow-hidden rounded-lg border border-slate-700">
            {(["los_angeles", "napa"] as const).map((c) => (
              <button
                key={c}
                onClick={() => switchCounty(c)}
                className={
                  county === c
                    ? "bg-cyan-500 px-3 py-1 text-xs font-medium text-white"
                    : "bg-transparent px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
                }
              >
                {COUNTY_VIEWS[c].label}
              </button>
            ))}
          </div>
        </div>

        {/* Address search */}
        <div className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-xl bg-white p-2 shadow-lg">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void searchAddress();
            }}
            placeholder={`Enter an address in ${COUNTY_VIEWS[county].label}…`}
            className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button
            onClick={() => void searchAddress()}
            disabled={loading}
            className="shrink-0 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
          >
            {loading ? "…" : "Search"}
          </button>
        </div>
      </div>

      {/* Status pill */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/95 px-4 py-1.5 text-xs font-medium text-slate-600 shadow">
        {!mapReady ? "Loading map…" : status}
      </div>

      {/* Result panel */}
      {parcel && parcel.status === "ok" && (
        <div className="absolute bottom-16 left-4 z-10 w-80 max-w-[90vw] rounded-xl bg-white p-4 shadow-xl">
          <div className="flex flex-col gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-cyan-600">
              {parcel.label} County
            </div>
            <div>
              <div className="text-xs text-slate-500">APN</div>
              <div className="font-mono text-base font-semibold text-slate-900">{parcel.apn}</div>
            </div>
            {parcel.address ? (
              <div>
                <div className="text-xs text-slate-500">Address</div>
                <div className="text-sm text-slate-900">{parcel.address}</div>
              </div>
            ) : null}
            <div>
              <div className="text-xs text-slate-500">Lot size</div>
              <div className="text-base font-semibold text-slate-900">{parcel.acreage} acres</div>
            </div>
            <div className="border-t border-slate-100 pt-2 text-[11px] text-slate-400">
              Next from the engine: zoning district, buildable envelope, flood &amp; fire.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
