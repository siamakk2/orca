// Runs on Vercel at build time (postbuild). Tests the Napa address→parcel chain
// from inside Vercel's network and reports raw results to Supabase for diagnosis.
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

async function jfetch(url, params, tag) {
  const u = `${url}?${new URLSearchParams(params)}`;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    const out = { url: u.slice(0, 500), http: r.status, ok: r.ok, error: json?.error || null,
      count: json?.features?.length ?? null, preview: text.slice(0, 800) };
    await log(tag, out);
    return json;
  } catch (e) {
    await log(tag, { url: u.slice(0, 500), thrown: String(e?.message || e) });
    return null;
  }
}

const ADDR = "https://gis.napacounty.gov/arcgis/rest/services/Hosted/Addresses_Main_All/FeatureServer/0/query";
const PARCELS = "https://gis.napacounty.gov/arcgis/rest/services/Hosted/Parcels_Public/FeatureServer/0/query";

(async () => {
  await log("selftest_start", { commit: process.env.VERCEL_GIT_COMMIT_SHA || "local", env: process.env.VERCEL_ENV || "local" });

  // A) E911: exact number + street
  const a = await jfetch(ADDR, {
    where: "UPPER(streetname) LIKE '%LONGHORN%' AND addressnum='55'",
    outFields: "addressnum,streetname,fulladdress", returnGeometry: "true", outSR: "4326", f: "json", resultRecordCount: "10",
  }, "e911_exact");

  // B) E911: street only
  const b = await jfetch(ADDR, {
    where: "UPPER(streetname) LIKE '%LONGHORN%'",
    outFields: "addressnum,streetname,fulladdress", returnGeometry: "true", outSR: "4326", f: "json", resultRecordCount: "25",
  }, "e911_street");

  // C) E911: fulladdress variant
  await jfetch(ADDR, {
    where: "UPPER(fulladdress) LIKE '55 LONGHORN%'",
    outFields: "addressnum,streetname,fulladdress", returnGeometry: "true", outSR: "4326", f: "json", resultRecordCount: "10",
  }, "e911_fulladdr");

  // D) If we got a point, parcel under it
  const pt = a?.features?.[0]?.geometry || b?.features?.[0]?.geometry;
  if (pt && Number.isFinite(pt.x)) {
    await jfetch(PARCELS, {
      geometry: JSON.stringify({ x: pt.x, y: pt.y, spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
      outFields: "asmt,asmtwithdash,streetaddr,gis_acres", returnGeometry: "false", f: "json",
    }, "parcel_at_point");
  } else {
    await log("parcel_at_point", { skipped: "no E911 point found" });
  }

  // E) Parcels layer: does streetaddr know LONGHORN at all?
  await jfetch(PARCELS, {
    where: "UPPER(streetaddr) LIKE '%LONGHORN%'",
    outFields: "streetaddr,asmtwithdash", returnGeometry: "false", f: "json", resultRecordCount: "10",
  }, "parcels_streetaddr_longhorn");

  await log("selftest_end", { done: true });
  console.log("selftest complete");
})();
