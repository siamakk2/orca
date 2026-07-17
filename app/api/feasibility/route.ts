import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* overlay data layers per county */
const OV: Record<string, any> = {
  napa: {
    zoning: { url:"https://gis.napacounty.gov/arcgis/rest/services/Hosted/Zoning/FeatureServer/0/query", pick:["ZONE","ZONING","zoning","zone","ZONE_CODE","ZN_CODE","Zoning_Code","GENZONE","zntype"] },
    fire:   { url:"https://gis.napacounty.gov/arcgis/rest/services/Hosted/FHSZ/FeatureServer/0/query", pick:["HAZ_CLASS","HAZ_CODE","FHSZ","CLASS","SRA","HAZARD"] },
    williamson: { url:"https://gis.napacounty.gov/arcgis/rest/services/Hosted/Williamson_Act_Parcels_Public/FeatureServer/0/query", pick:["*"] },
  },
  los_angeles: {
    zoning: { url:"https://services2.arcgis.com/Q6Lq3evZUGfPrN7o/arcgis/rest/services/Planning%20and%20Development/FeatureServer/12/query", pick:["ZONING","ZONE","zoning","LABEL","ZONE_CMPLT","ZONE_CLASS"] },
  },
};
const FEMA = "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query";

/* summarized zoning rulebook — verify against county code + overlays */
const ZONES: Record<string, Record<string, any>> = {
  napa: {
    "AW":{name:"Agricultural Watershed",minAc:160,use:"Agriculture; one dwelling per legal parcel",cite:"Napa County Code Title 18, Ch. 18.20"},
    "AP":{name:"Agricultural Preserve",minAc:40,use:"Agriculture; limited residential",cite:"Title 18, Ch. 18.16"},
    "AC":{name:"Agriculture (Commercial)",minAc:40,use:"Agriculture + wineries",cite:"Title 18"},
    "RC":{name:"Residential Country",minAc:1,use:"Single-family rural residential",cite:"Title 18, Ch. 18.104"},
    "RR":{name:"Rural Residential",minAc:1,use:"Single-family, low density",cite:"Title 18"},
    "RS":{name:"Residential Suburban",minSf:20000,use:"Single-family suburban",cite:"Title 18"},
    "RU":{name:"Residential Urban",minSf:6000,use:"Single-family / duplex",cite:"Title 18"},
    "RM":{name:"Residential Multiple",minSf:6000,use:"Multi-family",cite:"Title 18"},
  },
  los_angeles: {
    "A-1":{name:"Light Agriculture",minSf:5000,use:"Agriculture + single-family",cite:"LA County Code Title 22"},
    "A-2":{name:"Heavy Agriculture",minAc:2,use:"Agriculture + single-family",cite:"Title 22"},
    "R-1":{name:"Single-Family Residence",minSf:5000,use:"One dwelling per lot",cite:"Title 22"},
    "R-A":{name:"Residential Agricultural",minSf:5000,use:"Single-family + limited ag",cite:"Title 22"},
    "R-R":{name:"Resort & Recreation",minSf:5000,use:"Resort residential",cite:"Title 22"},
    "R-2":{name:"Two-Family Residence",minSf:5000,use:"Up to two units",cite:"Title 22"},
    "R-3":{name:"Limited Multiple Residence",perUnitSf:2500,use:"Multi-family",cite:"Title 22"},
  },
};
const SETBACKS = { front:25, side:10, rear:20 };

function pick(attrs: Record<string, any>, names: string[]) {
  if (names.includes("*")) return attrs;
  for (const n of names) for (const k in attrs) if (k.toLowerCase() === n.toLowerCase() && attrs[k] != null && String(attrs[k]).trim() !== "") return attrs[k];
  for (const n of names) for (const k in attrs) if (k.toLowerCase().includes(n.toLowerCase()) && attrs[k] != null && String(attrs[k]).trim() !== "") return attrs[k];
  return null;
}
async function atPoint(url: string, lon: number, lat: number, fields = "*") {
  const p = new URLSearchParams({ geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: fields, returnGeometry: "false", f: "json" });
  const r = await fetch(`${url}?${p}`, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  if (d.error) throw new Error(d.error?.message || "GIS error");
  return d.features || [];
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lon = parseFloat(sp.get("lon") || ""), lat = parseFloat(sp.get("lat") || ""), ac = parseFloat(sp.get("acres") || "");
  const county = sp.get("county") || "napa";
  if (Number.isNaN(lon) || Number.isNaN(lat)) return NextResponse.json({ error: "lon/lat required" }, { status: 400 });
  const ov = OV[county] || {};
  const out: any = { buildability: {}, risk: {} };

  /* --- zoning + buildability --- */
  try {
    const f = (await atPoint(ov.zoning.url, lon, lat))[0];
    const raw = f ? pick(f.attributes, ov.zoning.pick) : null;
    const code = raw ? String(raw).trim().toUpperCase() : null;
    const book = ZONES[county] || {};
    let rule = null;
    if (code) rule = book[code] || book[code.split(/[\s\-:_]/)[0]] || book[Object.keys(book).find(k => code.startsWith(k)) as string];
    let units = null, minLot = "—", envelope = null;
    if (rule && !Number.isNaN(ac)) {
      const sf = ac * 43560;
      if (rule.minAc) { units = Math.max(1, Math.floor(ac / rule.minAc)); minLot = rule.minAc + " ac / dwelling"; }
      else if (rule.minSf) { units = Math.max(1, Math.floor(sf / rule.minSf)); minLot = rule.minSf.toLocaleString() + " sf min lot"; }
      else if (rule.perUnitSf) { units = Math.max(1, Math.floor(sf / rule.perUnitSf)); minLot = rule.perUnitSf.toLocaleString() + " sf / unit"; }
      const w = Math.sqrt(sf); envelope = Math.round(Math.max(0, w - 2 * SETBACKS.side) * Math.max(0, w - SETBACKS.front - SETBACKS.rear));
    }
    out.buildability = { code, name: rule?.name || null, use: rule?.use || null, minLot, maxUnits: units, envelope, cite: rule?.cite || null, adu: "1 ADU + 1 JADU likely (CA Gov. Code §65852.2)" };
  } catch { out.buildability = { error: true }; }

  /* --- FEMA flood --- */
  try {
    const f = (await atPoint(FEMA, lon, lat, "FLD_ZONE,SFHA_TF,ZONE_SUBTY"))[0];
    if (!f) out.risk.flood = { level: "green", text: "Not in a mapped flood zone" };
    else { const z = f.attributes.FLD_ZONE, sfha = f.attributes.SFHA_TF; const hi = sfha === "T" || /^(A|V)/.test(z || ""); out.risk.flood = { level: hi ? "red" : "green", text: hi ? `Zone ${z} — Special Flood Hazard` : `Zone ${z || "X"} — minimal risk` }; }
  } catch { out.risk.flood = { level: "gray", text: "FEMA unavailable — verify" }; }

  /* --- fire --- */
  if (ov.fire) { try {
    const f = (await atPoint(ov.fire.url, lon, lat))[0];
    if (!f) out.risk.fire = { level: "green", text: "Not in a mapped hazard zone" };
    else { const v = pick(f.attributes, ov.fire.pick); const s = String(v || "").toUpperCase(); out.risk.fire = { level: /VERY|HIGH/.test(s) ? "red" : "amber", text: v || "Mapped fire hazard" }; }
  } catch { out.risk.fire = { level: "gray", text: "Check CAL FIRE FHSZ" }; } }
  else out.risk.fire = { level: "gray", text: "Check CAL FIRE FHSZ" };

  /* --- Williamson Act --- */
  if (ov.williamson) { try {
    const f = await atPoint(ov.williamson.url, lon, lat);
    out.risk.williamson = f.length ? { level: "red", text: "Under contract — development-restricted" } : { level: "green", text: "Not under contract" };
  } catch { out.risk.williamson = { level: "gray", text: "Verify with county" }; } }
  else out.risk.williamson = { level: "gray", text: "N/A this county" };

  /* --- slope/terrain heuristic --- */
  out.risk.terrain = ac > 5 ? { level: "amber", text: "Large rural lot — confirm slope/access" } : { level: "gray", text: "Review on site" };

  return NextResponse.json(out);
}
