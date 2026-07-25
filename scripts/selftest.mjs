// Runs on Vercel at build time (postbuild), inside Vercel's network, and reports to Supabase.
// Purpose: introspect every county parcel layer and record its ACTUAL field names, so the
// address/APN field mappings in app/api/parcel/route.ts can be corrected from evidence
// instead of guessed. Blank addresses in the UI almost always mean a mapped field
// doesn't exist on that layer.
const SB = "https://rlvibtvyaunuiwizqigj.supabase.co/rest/v1/orca_diag";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsdmlidHZ5YXVudWl3aXpxaWdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MjExMDMsImV4cCI6MjA5Nzk5NzEwM30.rnqUIK4rhKCBkcWZLY8qqF8lKqu1FEcb2J33VuRExh0";

async function log(tag, data) {
  try {
    await fetch(SB, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ tag, data }),
    });
  } catch (e) { console.log("diag log failed:", e?.message); }
}

const SOURCES = [
  ["los_angeles", "https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0/query", ["AIN","APN"], ["SitusFullAddress","SitusAddress"], null],
  ["napa", "https://gis.napacounty.gov/arcgis/rest/services/Hosted/Parcels_Public/FeatureServer/0/query", ["asmtwithdash","asmt"], ["streetaddr"], null],
  ["orange", "https://www.ocgis.com/arcpub/rest/services/Map_Layers/Parcels/MapServer/0/query", ["ASSESSMENT_NO"], ["SITE_ADDRESS"], null],
  ["san_diego", "https://webmaps.sandiego.gov/arcgis/rest/services/GeocoderMerged/MapServer/1/query", ["APN","APN_8"], ["SITUS_STREET"], ["SITUS_ADDRESS"]],
  ["san_bernardino", "https://services.arcgis.com/aA3snZwJfFkVyDuP/arcgis/rest/services/Parcels_for_San_Bernardino_County/FeatureServer/0/query", ["ParcelNumber"], ["SitusAddress","Address"], null],
  ["sacramento", "https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/Parcels/FeatureServer/0/query", ["APN"], ["STREET_NAM"], ["STREET_NBR"]],
  ["santa_clara", "https://services8.arcgis.com/fpjs8A5Vtkshblnd/arcgis/rest/services/Santa_Clara_County_Parcels/FeatureServer/0/query", ["apn"], ["situs_stre"], ["situs_hous"]],
  ["alameda", "https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Parcels/FeatureServer/0/query", ["APN"], ["SitusAddress","SitusStreetName"], null],
  ["contra_costa", "https://gis.cccounty.us/arcgis/rest/services/CCMAP/Assessment_Parcels_ArcPro/MapServer/0/query", ["APN"], ["N_STR_NM"], ["N_STR_NBR"]],
  ["ventura", "https://maps.ventura.org/arcgis/rest/services/SDs/Parcels/MapServer/0/query", ["APN","APN10"], ["SITUS","SITUS_STRE"], null],
  ["sonoma", "https://socogis.sonomacounty.ca.gov/map/rest/services/OWTSPublic/Cities_GIS_Parcel_Base/FeatureServer/0/query", ["APN"], ["SitusFormatted1","SitusStreetName"], null],
];

// LACounty_Cache returns null for every attribute (tile cache, not a queryable record layer) and the
// San Bernardino layer publishes no situs fields at all. Probe candidate replacements so the mapping
// can be corrected from evidence on the next pass.
const CANDIDATES = [
  ["la_cand_dynamic", "https://public.gis.lacounty.gov/public/rest/services/LACounty_Dynamic/Parcel/MapServer/0/query"],
  ["la_cand_parcels", "https://public.gis.lacounty.gov/public/rest/services/PARCEL/MapServer/0/query"],
  ["la_cand_assessor", "https://services5.arcgis.com/3lQzeQmwoglGXmqz/arcgis/rest/services/LACounty_Parcels/FeatureServer/0/query"],
  ["sb_cand_assessor", "https://services.arcgis.com/aA3snZwJfFkVyDuP/arcgis/rest/services/Assessor_Parcels/FeatureServer/0/query"],
  ["sb_cand_open", "https://open.sbcounty.gov/arcgis/rest/services/Parcels/MapServer/0/query"],
];

const ADDRISH = /(situs|addr|street|str_|st_nm|house|hous|nbr|num|site)/i;
const APNISH = /(apn|ain|parcel|asmt|assess)/i;

async function introspect(slug, queryUrl, apnCfg, addrCfg, numCfg) {
  const meta = queryUrl.replace(/\/query$/, "");
  const out = { slug, reachable: false };
  try {
    const r = await fetch(`${meta}?f=json`, { signal: AbortSignal.timeout(20000) });
    out.http = r.status;
    const j = JSON.parse(await r.text());
    if (j && j.error) { out.error = (j.error && j.error.message) || "layer error"; await log("fields", out); return; }
    out.reachable = true;
    const fields = (j.fields || []).map(f => f.name);
    out.fieldCount = fields.length;
    out.apn_cfg = apnCfg;   out.apn_missing = apnCfg.filter(f => !fields.includes(f));
    out.addr_cfg = addrCfg; out.addr_missing = addrCfg.filter(f => !fields.includes(f));
    if (numCfg) { out.num_cfg = numCfg; out.num_missing = numCfg.filter(f => !fields.includes(f)); }
    out.address_candidates = fields.filter(f => ADDRISH.test(f)).slice(0, 40);
    out.apn_candidates = fields.filter(f => APNISH.test(f)).slice(0, 20);
  } catch (e) {
    out.thrown = String((e && e.message) || e);
  }
  await log("fields", out);

  if (out.reachable) {
    try {
      const p = new URLSearchParams({ where: "1=1", outFields: "*", returnGeometry: "false", resultRecordCount: "1", f: "json" });
      const r2 = await fetch(`${queryUrl}?${p}`, { signal: AbortSignal.timeout(20000) });
      const j2 = JSON.parse(await r2.text());
      const attrs = (j2 && j2.features && j2.features[0] && j2.features[0].attributes) || {};
      const sample = {};
      for (const k of Object.keys(attrs)) {
        if (ADDRISH.test(k) || APNISH.test(k)) sample[k] = String(attrs[k]).slice(0, 60);
      }
      await log("sample", { slug, sample });
    } catch (e) {
      await log("sample", { slug, thrown: String((e && e.message) || e) });
    }
  }
}

(async () => {
  await log("introspect_start", { commit: process.env.VERCEL_GIT_COMMIT_SHA || "local", env: process.env.VERCEL_ENV || "local", n: SOURCES.length });
  for (const s of SOURCES) { await introspect(s[0], s[1], s[2], s[3], s[4]); }
  // Real address queries — a single 1=1 sample row proves nothing about whether a layer is populated.
  const PROBES = [
    ["statewide_fire", "https://services.gis.ca.gov/arcgis/rest/services/Environment/Fire_Severity_Zones/MapServer/0/query", "1=1"],
    ["la_zoning_cfg", "https://services2.arcgis.com/Q6Lq3evZUGfPrN7o/arcgis/rest/services/Planning%20and%20Development/FeatureServer/12/query", "1=1"],
    ["la_probe", "https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0/query", "UPPER(SitusStreet) LIKE '%SPRING%' AND SitusHouseNo='200'"],
    ["la_probe_any", "https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0/query", "SitusFullAddress IS NOT NULL"],
    ["sd_probe", "https://webmaps.sandiego.gov/arcgis/rest/services/GeocoderMerged/MapServer/1/query", "UPPER(SITUS_STREET) LIKE '%PACIFIC%' AND SITUS_ADDRESS='1600'"],
  ];
  for (const [slug, url, where] of PROBES) {
    try {
      const p = new URLSearchParams({ where, outFields: "*", returnGeometry: "false", resultRecordCount: "3", f: "json" });
      const r = await fetch(`${url}?${p}`, { signal: AbortSignal.timeout(25000) });
      const j = JSON.parse(await r.text());
      const feats = (j && j.features) || [];
      await log("probe", { slug, http: r.status, error: (j && j.error && j.error.message) || null,
        count: feats.length, attrs: feats.slice(0, 2).map(f => f.attributes) });
    } catch (e) { await log("probe", { slug, thrown: String((e && e.message) || e) }); }
  }
  await log("introspect_done", { commit: process.env.VERCEL_GIT_COMMIT_SHA || "local" });
  console.log("field introspection complete");
})();
