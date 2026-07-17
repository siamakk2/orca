"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type CountySlug = "los_angeles" | "napa";

const COUNTY_VIEWS: Record<CountySlug, { center: [number, number]; zoom: number; label: string }> = {
  los_angeles: { center: [-118.2437, 34.0522], zoom: 11, label: "Los Angeles" },
  napa: { center: [-122.2869, 38.4], zoom: 10, label: "Napa" },
};

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
  const [loading, setLoading] = useState(false);
  const [parcel, setParcel] = useState<Parcel | null>(null);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: COUNTY_VIEWS.los_angeles.center,
      zoom: COUNTY_VIEWS.los_angeles.zoom,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("parcel", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "parcel-fill",
        type: "fill",
        source: "parcel",
        paint: { "fill-color": "#06b6d4", "fill-opacity": 0.25 },
      });
      map.addLayer({
        id: "parcel-line",
        type: "line",
        source: "parcel",
        paint: { "line-color": "#0e7490", "line-width": 2.5 },
      });
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

  async function lookup(lat: number, lon: number) {
    setLoading(true);
    setParcel(null);
    const map = mapRef.current;
    try {
      const res = await fetch(`/api/parcel?lat=${lat}&lon=${lon}`);
      const data: Parcel = await res.json();
      setParcel(data);
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
        map.fitBounds(b, { padding: 60, maxZoom: 17 });
      } else if (src) {
        src.setData({ type: "FeatureCollection", features: [] });
      }
    } catch {
      setParcel({ status: "error", message: "Lookup failed — try again." });
    } finally {
      setLoading(false);
    }
  }

  function switchCounty(c: CountySlug) {
    setCounty(c);
    const v = COUNTY_VIEWS[c];
    mapRef.current?.flyTo({ center: v.center, zoom: v.zoom });
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="absolute left-4 top-4 z-10 flex items-center gap-3 rounded-xl bg-[#0f172a]/95 px-4 py-3 shadow-lg backdrop-blur">
        <span className="text-lg font-semibold tracking-tight text-white">Orca</span>
        <span className="hidden text-xs text-slate-400 sm:inline">Parcel &amp; Zoning Intelligence</span>
        <div className="ml-1 flex overflow-hidden rounded-lg border border-slate-700">
          {(["los_angeles", "napa"] as const).map((c) => (
            <button
              key={c}
              onClick={() => switchCounty(c)}
              className={
                county === c
                  ? "px-3 py-1 text-xs font-medium transition-colors bg-cyan-500 text-white"
                  : "px-3 py-1 text-xs font-medium transition-colors bg-transparent text-slate-300 hover:bg-slate-800"
              }
            >
              {COUNTY_VIEWS[c].label}
            </button>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-white/90 px-4 py-1.5 text-xs font-medium text-slate-600 shadow">
        {loading ? "Fetching parcel\u2026" : "Click anywhere on the map to pull that parcel"}
      </div>

      {parcel && (
        <div className="absolute bottom-4 left-4 z-10 w-80 max-w-[90vw] rounded-xl bg-white p-4 shadow-xl">
          {parcel.status === "ok" ? (
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
                Next from the engine: buildable envelope, flood zone, and zoning.
              </div>
            </div>
          ) : (
            <div className="text-sm leading-6 text-slate-700">
              {parcel.message || "No parcel found here."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
