"""
parcel_fetcher.py — Project Orca spatial backend

Real replacement for SpatialIngestionEngine.fetch_parcel_boundary().
Given a WGS84 point, resolves the county, queries that county's public
ArcGIS REST parcel layer with a point-intersect, and returns the parcel
in the exact shape the existing pipeline contract expects:

    { "apn", "county_fips", "address", "geometry" (4326 GeoJSON) }

...plus two extras the envelope math downstream will want:
    "state_plane_epsg"  -> the projected CRS to do setback/area math in
    "acreage"           -> lot size, computed in that projected CRS

Scope: unincorporated-first, two counties. Incorporated cities are a
phase-2 corpus expansion gated behind real jurisdiction resolution.

Endpoint status:
  * Los Angeles — LIVE, verified. Authoritative county cache + a documented
    FeatureServer fallback with richer attributes.
  * Napa        — host + CRS confirmed (gis.napa.ca.gov/arcgis, EPSG:2226).
    The exact service PATH and field names are marked CONFIRM below; run
    discover_services("napa") from a network that can reach the county
    server to lock them, then delete the CONFIRM note.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform as shp_transform


# --------------------------------------------------------------------------
# Per-county registry. One place to add the next county.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class ParcelSource:
    query_url: str
    # candidate field names, tried in order; first present wins (schemas differ per county)
    apn_fields: tuple[str, ...]
    address_fields: tuple[str, ...]
    confirmed: bool = True          # False => path/fields are provisional, run discover_services()


@dataclass(frozen=True)
class CountyConfig:
    slug: str
    fips: str
    state_plane_epsg: int           # CA state plane, ftUS — used for area + setbacks
    bbox: tuple[float, float, float, float]   # (west, south, east, north) in 4326, coarse v1 router
    primary: ParcelSource
    fallback: Optional[ParcelSource] = None


REGISTRY: dict[str, CountyConfig] = {
    "los_angeles": CountyConfig(
        slug="los_angeles",
        fips="06037",
        state_plane_epsg=2229,      # CA Zone 5
        bbox=(-118.95, 33.70, -117.64, 34.82),
        primary=ParcelSource(
            # LA County Assessor public parcel cache — verified live, no key.
            # Owner name/mailing address are withheld here per CA Gov Code §7928.205.
            query_url="https://public.gis.lacounty.gov/public/rest/services/"
                      "LACounty_Cache/LACounty_Parcel/MapServer/0/query",
            apn_fields=("AIN", "APN"),
            address_fields=("SitusFullAddress", "SitusAddress", "situsAddress"),
        ),
        fallback=ParcelSource(
            # Documented hosted FeatureServer mirror (richer attrs: UseType, values).
            # FeatureServers handle geometry + pagination more predictably than a cache.
            query_url="https://services3.arcgis.com/GVgbJbqm8hXASVYi/arcgis/rest/services/"
                      "LA_County_Parcels/FeatureServer/0/query",
            apn_fields=("APN", "AIN"),
            address_fields=("SitusAddress", "SitusFullAddress"),
        ),
    ),
    "napa": CountyConfig(
        slug="napa",
        fips="06055",
        state_plane_epsg=2226,      # CA Zone 2  (confirmed from live service SR 102642)
        bbox=(-122.65, 38.15, -122.06, 38.87),
        primary=ParcelSource(
            # CONFIRM: host is right, exact service path + fields are provisional.
            # Run discover_services("napa") to verify, then flip confirmed=True.
            query_url="https://gis.napa.ca.gov/arcgis/rest/services/"
                      "Parcels/Parcels/MapServer/0/query",
            apn_fields=("APN", "PARCEL", "ParcelNumber"),
            address_fields=("SitusAddress", "SITUS", "SitusFullAddress"),
            confirmed=False,
        ),
    ),
}

_DISCOVERY_ROOT = {
    "los_angeles": "https://public.gis.lacounty.gov/public/rest/services",
    "napa": "https://gis.napa.ca.gov/arcgis/rest/services",
}


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------

class ParcelFetchError(RuntimeError):
    """Raised when a parcel cannot be resolved. Never returns a silent empty result."""


# --------------------------------------------------------------------------
# Geometry helpers (pure, no network)
# --------------------------------------------------------------------------

def _ring_is_clockwise(ring: list[list[float]]) -> bool:
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += (x2 - x1) * (y2 + y1)
    return s > 0  # shoelace with this sign convention: >0 => CW (Esri exterior)


def esri_rings_to_geojson(rings: list[list[list[float]]]) -> dict[str, Any]:
    """Esri polygon rings -> GeoJSON Polygon/MultiPolygon.

    Esri: exterior rings clockwise, holes counter-clockwise, no explicit nesting.
    """
    outers = [r for r in rings if _ring_is_clockwise(r)]
    holes = [r for r in rings if not _ring_is_clockwise(r)]
    if not outers:                       # degenerate; treat everything as exterior
        outers, holes = rings, []
    polys: list[list[list[list[float]]]] = [[o] for o in outers]
    for h in holes:                      # attach holes to the first outer (fine for single-parcel)
        polys[0].append(h)
    if len(polys) == 1:
        return {"type": "Polygon", "coordinates": polys[0]}
    return {"type": "MultiPolygon", "coordinates": polys}


def acreage(geojson_geom: dict[str, Any], epsg: int) -> float:
    """Area in acres, computed in a projected ftUS CRS (never in 4326 degrees)."""
    geom = shape(geojson_geom)
    to_sp = Transformer.from_crs(4326, epsg, always_xy=True).transform
    return shp_transform(to_sp, geom).area / 43560.0


def route_county(lon: float, lat: float) -> Optional[str]:
    """Coarse bbox router (v1). Real jurisdiction resolution = point-in-polygon
    against county + city boundaries; this is deliberately the cheap first pass."""
    for slug, cfg in REGISTRY.items():
        w, s, e, n = cfg.bbox
        if w <= lon <= e and s <= lat <= n:
            return slug
    return None


def _first_present(attrs: dict[str, Any], names: tuple[str, ...]) -> Optional[str]:
    for k in names:
        v = attrs.get(k)
        if v not in (None, "", " "):
            return str(v).strip()
    return None


# --------------------------------------------------------------------------
# ArcGIS query (async). Pagination-aware even though point-intersect returns 1.
# The same helper is what you'll reuse for envelope / bulk queries later.
# --------------------------------------------------------------------------

async def _arcgis_query(
    client: httpx.AsyncClient,
    query_url: str,
    params: dict[str, Any],
    *,
    page_size: int = 1000,
) -> list[dict[str, Any]]:
    """POST a query and follow resultOffset pagination until the server stops
    setting exceededTransferLimit. ArcGIS signals bad requests with HTTP 200 +
    an {"error": ...} body, so we check the body, not just the status code."""
    features: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = {**params, "resultOffset": offset, "resultRecordCount": page_size}
        resp = await client.post(query_url, data=page, timeout=20)
        resp.raise_for_status()
        payload = resp.json()
        if "error" in payload:                       # the silent-failure trap — surface it loudly
            raise ParcelFetchError(f"ArcGIS rejected query: {payload['error']}")
        batch = payload.get("features", [])
        features.extend(batch)
        if not payload.get("exceededTransferLimit") or not batch:
            break
        offset += len(batch)
    return features


async def _query_source(
    client: httpx.AsyncClient, src: ParcelSource, lon: float, lat: float
) -> Optional[dict[str, Any]]:
    esri_point = {"x": lon, "y": lat, "spatialReference": {"wkid": 4326}}
    params = {
        "geometry": json.dumps(esri_point),
        "geometryType": "esriGeometryPoint",
        "inSR": 4326,
        "outSR": 4326,                 # keep the contract in WGS84; project only for math
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "returnGeometry": "true",
        "f": "json",
    }
    feats = await _arcgis_query(client, src.query_url, params)
    if not feats:
        return None
    feat = feats[0]                    # a point intersects exactly one parcel
    rings = feat.get("geometry", {}).get("rings")
    if not rings:
        raise ParcelFetchError("Parcel matched but server returned no geometry.")
    attrs = feat.get("attributes", {})
    return {
        "attributes": attrs,
        "apn": _first_present(attrs, src.apn_fields),
        "address": _first_present(attrs, src.address_fields),
        "geometry": esri_rings_to_geojson(rings),
    }


# --------------------------------------------------------------------------
# Public entrypoint — matches fetch_parcel_boundary(lat, lon)
# --------------------------------------------------------------------------

async def fetch_parcel_boundary(
    lat: float,
    lon: float,
    county: Optional[str] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> dict[str, Any]:
    """Resolve the parcel containing (lat, lon). Drop-in for the mock of the
    same name. Raises ParcelFetchError rather than returning an empty/false
    result — a due-diligence pipeline must never silently report 'nothing here'."""
    slug = county or route_county(lon, lat)
    if slug is None:
        raise ParcelFetchError(
            f"Point ({lat}, {lon}) is outside supported counties (LA, Napa)."
        )
    cfg = REGISTRY[slug]

    owns_client = client is None
    client = client or httpx.AsyncClient(headers={"User-Agent": "orca-spatial/1.0"})
    try:
        record = await _query_source(client, cfg.primary, lon, lat)
        if record is None and cfg.fallback is not None:
            record = await _query_source(client, cfg.fallback, lon, lat)
    finally:
        if owns_client:
            await client.aclose()

    if record is None:
        raise ParcelFetchError(f"No parcel found at ({lat}, {lon}) in {slug}.")

    geom = record["geometry"]
    return {
        "apn": record["apn"] or "UNKNOWN",
        "county_fips": cfg.fips,
        "address": record["address"] or "",
        "geometry": geom,
        "state_plane_epsg": cfg.state_plane_epsg,
        "acreage": round(acreage(geom, cfg.state_plane_epsg), 4),
        "_source_confirmed": cfg.primary.confirmed,
    }


async def discover_services(county_slug: str) -> dict[str, Any]:
    """List a county's ArcGIS REST services/folders so you can confirm the exact
    parcel + zoning paths from a network that can reach the county server.
    Use this to lock Napa's provisional path."""
    root = _DISCOVERY_ROOT[county_slug]
    async with httpx.AsyncClient() as client:
        resp = await client.get(root, params={"f": "json"}, timeout=20)
        resp.raise_for_status()
        return resp.json()


if __name__ == "__main__":
    import asyncio

    async def _demo() -> None:
        # LA — live. Central LA point; expect a real AIN + geometry.
        try:
            la = await fetch_parcel_boundary(34.0718, -118.2596)
            print("LA:", la["apn"], la["county_fips"], f'{la["acreage"]} ac', la["address"])
        except ParcelFetchError as e:
            print("LA fetch failed:", e)

        # Napa — will 404/err until the CONFIRM path is verified via discover_services.
        try:
            print("Napa services (confirm parcel path here):")
            svc = await discover_services("napa")
            print(json.dumps(svc.get("services", svc), indent=2)[:1200])
        except Exception as e:  # noqa: BLE001 — discovery is best-effort
            print("Napa discovery failed (network reachability?):", e)

    asyncio.run(_demo())
