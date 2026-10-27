"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const CARTO = "cb1_2vn8_1_1181f76222b527b9a9ae311b";
const STYLE = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: ["a", "b", "c"].map(s => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${CARTO}`),
      tileSize: 256,
      attribution: "© OpenStreetMap © CARTO",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
} as unknown as maplibregl.StyleSpecification;

type Match = { apn: string; address: string; acreage: number; label: string; geometry: GeoJSON.Geometry; attrs: Record<string, any>; zoning?: string; zoning_description?: string };

/* ──────────────────────────────────────────────────────────────────────────
   Field readers. County layers disagree on nearly every field name, so each
   fact is looked up through a list of aliases rather than a single key.
   ────────────────────────────────────────────────────────────────────────── */
function pickVal(a: Record<string, any>, names: string[]) {
  for (const nm of names) for (const k in a) { if (k.toLowerCase() === nm.toLowerCase() && a[k] != null && String(a[k]).trim() !== "") return a[k]; }
  return null;
}
function numOf(v: any): number | null { const n = Number(v); return v == null || v === "" || Number.isNaN(n) ? null : n; }
function money(v: any) { const n = Number(v); return v == null || Number.isNaN(n) || n === 0 ? null : "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 }); }

const TOTALF = ["Roll_totalValue", "TotalValue", "total_val", "NetValue", "Value601NetValue", "Value601TotalLI", "AssessedValue", "ASSD_TOTAL", "assd_total", "total_value", "parval", "saleprice"];
const PARTF = ["Roll_LandValue", "Roll_ImpValue", "Roll_FixtureValue", "Roll_PersPropValue"];
// Several counties (LA among them) publish no total — only components. Summing them is the
// difference between a real number and "not in public layer" on every parcel in the county.
function assessedTotal(a: Record<string, any>): number | null {
  const t = pickVal(a, TOTALF); const tn = Number(t);
  if (t != null && !Number.isNaN(tn) && tn > 0) return tn;
  let sum = 0, seen = false;
  for (const f of PARTF) { const v = pickVal(a, [f]); const n = Number(v); if (v != null && !Number.isNaN(n) && n > 0) { sum += n; seen = true; } }
  return seen ? sum : null;
}
// A tax-exempt parcel (government, church, school) legitimately has no roll values. Say which.
function exemptish(a: Record<string, any>): boolean {
  const u = String(pickVal(a, ["UseType", "UseDescription", "UseCodeDescription", "AssessDescription", "usedesc", "LANDUSE"]) || "").toLowerCase();
  return /government|exempt|church|school|public|municipal/.test(u);
}
// Counties hand back dates as epoch milliseconds, ISO strings, or bare years.
function asDate(v: any): Date | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isNaN(n) && n > 1e10) { const d = new Date(n); return isNaN(+d) ? null : d; }
  const d = new Date(String(v)); return isNaN(+d) ? null : d;
}
const monthYear = (d: Date) => d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
function centroid(g: any) { const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates; let x = 0, y = 0, n = 0; polys.forEach((pl: any) => pl[0].forEach((c: any) => { x += c[0]; y += c[1]; n++; })); return [x / n, y / n]; }

/* ── Derived facts the raw layers contain but the record never showed ── */

// Recorded sales. A prior sale turns a single price into a holding period and a rate of change.
function saleHistory(a: Record<string, any>) {
  const price = numOf(pickVal(a, ["SaleSalesPrice", "SalePrice", "saleprice", "LastSalePrice"]));
  const date = asDate(pickVal(a, ["SaleRecordingDate", "SaleDate", "saledate", "LastSaleDate"]));
  const pPrice = numOf(pickVal(a, ["SalePriorSalesPrice", "PriorSalePrice"]));
  const pDate = asDate(pickVal(a, ["SalePriorRecordingDate", "PriorSaleDate"]));
  let annual: number | null = null, held: number | null = null;
  if (price && pPrice && date && pDate) {
    const yrs = (+date - +pDate) / (365.25 * 864e5);
    if (yrs >= 1) { annual = (Math.pow(price / pPrice, 1 / yrs) - 1) * 100; held = yrs; }
  }
  const sinceLast = date ? (Date.now() - +date) / (365.25 * 864e5) : null;
  return { price, date, pPrice, pDate, annual, held, sinceLast, any: !!(price || date) };
}

// Which planning counter actually governs this parcel. Getting this wrong is the single
// most expensive mistake in pre-acquisition — an unincorporated lot with a city mailing
// address is not the city's to approve.
function jurisdiction(a: Record<string, any>, county: string) {
  const cityType = String(pickVal(a, ["CityType"]) || "");
  const poCity = pickVal(a, ["POCity", "SitusCity", "TaxRateCity", "situs_city"]);
  const unincorporated = /unincorp/i.test(cityType);
  const incorporated = !!cityType && !unincorporated;
  const body = unincorporated ? `${county} County planning department`
    : incorporated && poCity ? `City of ${String(poCity).replace(/\s*CA$/i, "").replace(/\*/g, "").trim()} planning department`
    : `${county} County planning department`;
  return {
    body,
    status: unincorporated ? "Unincorporated county land" : incorporated ? `Incorporated — ${String(poCity || "city").replace(/\s*CA$/i, "").replace(/\*/g, "").trim()}` : null,
    mailCity: poCity ? String(poCity).replace(/\*/g, "").trim() : null,
    supervisor: pickVal(a, ["Supervisor"]),
    district: pickVal(a, ["SupNum"]),
    url: pickVal(a, ["URL"]),
    taxArea: pickVal(a, ["TaxRateAreaDescription", "TaxRateArea"]),
    known: !!cityType,
  };
}

// "NORMAL OWNERSHIP" is the uninteresting case. Anything else — a Prop 8 decline-in-value
// reduction, a disaster calamity adjustment — is the county telling you something happened here.
function taxNote(a: Record<string, any>) {
  const t = String(pickVal(a, ["TaxabilityDescription"]) || "").trim();
  if (!t || /normal ownership/i.test(t)) return null;
  const prop8 = /prop\s*8|decline|calamity|disaster/i.test(t);
  return { text: t.replace(/\b([A-Z])([A-Z]+)\b/g, (_m, a1, b) => a1 + b.toLowerCase()), prop8 };
}

function williamsonContract(a: Record<string, any>) {
  const no = pickVal(a, ["ContractNo"]);
  const eff = asDate(pickVal(a, ["ContractEffDate"]));
  const exp = asDate(pickVal(a, ["ContractExpDate"]));
  const nonRenewal = numOf(pickVal(a, ["NonRenewal"]));
  if (!no && !eff && !exp) return null;
  return { no, eff, exp, nonRenewal: nonRenewal === 1 };
}

function drawShape(doc: any, geo: any, x: number, y: number, w: number, h: number) {
  const ring = geo?.type === "Polygon" ? geo.coordinates[0] : geo?.coordinates?.[0]?.[0];
  if (!ring || !ring.length) return;
  let mnX = 1e9, mnY = 1e9, mxX = -1e9, mxY = -1e9;
  ring.forEach((c: any) => { mnX = Math.min(mnX, c[0]); mxX = Math.max(mxX, c[0]); mnY = Math.min(mnY, c[1]); mxY = Math.max(mxY, c[1]); });
  const dx = (mxX - mnX) || 1, dy = (mxY - mnY) || 1, s = Math.min(w / dx, h / dy);
  const ox = x + (w - dx * s) / 2, oy = y + (h - dy * s) / 2;
  const pts = ring.map((c: any) => [ox + (c[0] - mnX) * s, oy + (mxY - c[1]) * s]);
  const rel = pts.slice(1).map((p: any, i: number) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
  doc.setFillColor(222, 234, 246); doc.setDrawColor(47, 116, 192); doc.setLineWidth(0.5);
  doc.lines(rel, pts[0][0], pts[0][1], [1, 1], "FD", true);
}

/* ──────────────────────────────────────────────────────────────────────────
   Styles. One light source, from above: raised surfaces carry a hairline
   highlight on their top edge and cast downward; recessed wells take the
   shadow on their inside top edge. Depth is the organising idea, so a single
   uniform drop-shadow on every card would undo the whole thing.
   ────────────────────────────────────────────────────────────────────────── */
const CSS = `
.k2{
  --ink:#2a2420; --paper:#fffdfa; --cream:#faf8f4; --line:#ece6de; --hair:#f3efe9;
  --taupe:#7d7267; --mute:#a89e94; --blue:#2f74c0; --blue-d:#255f9f;
  --good:#15803d; --warn:#b45309; --bad:#be123c;
  --e1:0 1px 2px rgba(58,46,36,.06), 0 2px 5px rgba(58,46,36,.05);
  --e2:0 2px 4px rgba(58,46,36,.07), 0 10px 22px rgba(58,46,36,.09);
  --e3:0 3px 6px rgba(58,46,36,.08), 0 20px 48px rgba(58,46,36,.17);
  --lift:inset 0 1px 0 rgba(255,255,255,.85);
  --well:inset 0 2px 4px rgba(58,46,36,.10), inset 0 -1px 0 rgba(255,255,255,.65);
  position:relative;height:100dvh;width:100vw;overflow:hidden;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);
  font-variant-numeric:tabular-nums;
}
.k2 *{box-sizing:border-box}
.k2 :focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:4px}
.k2-map{position:absolute;inset:0;background:#e9eef2}

/* ── floating chrome ── */
.bar{position:absolute;top:0;left:0;right:0;z-index:12;display:flex;flex-wrap:wrap;gap:10px;
  padding:14px;align-items:flex-start;justify-content:space-between;pointer-events:none}
.bar>*{pointer-events:auto}
.mark{display:flex;align-items:center;gap:10px;text-decoration:none;background:rgba(255,255,255,.92);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(236,230,222,.9);
  border-radius:13px;padding:8px 14px;box-shadow:var(--e2),var(--lift)}
.mark img{height:28px;width:28px;object-fit:contain}
.mark b{font-size:15.5px;font-weight:700;letter-spacing:-.02em;color:var(--ink)}
.mark b i{font-style:normal;color:var(--blue)}
.mark small{display:block;font-size:9.5px;font-weight:600;color:var(--mute);letter-spacing:.01em}
.mark .tag{font-size:11px;font-weight:600;color:var(--blue);background:#eaf3fc;padding:3px 9px;border-radius:999px}

.find{display:flex;gap:7px;background:rgba(255,255,255,.95);backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);border:1px solid rgba(236,230,222,.9);border-radius:13px;padding:7px;
  box-shadow:var(--e2),var(--lift);flex:1 1 340px;max-width:470px}
.find input{flex:1;min-width:0;border:none;outline:none;background:none;font:400 14.5px/1 inherit;
  color:var(--ink);padding:9px 11px}
.find input::placeholder{color:var(--mute)}
.btn{border:none;border-radius:9px;background:var(--blue);color:#fff;font:600 14px/1 inherit;
  padding:10px 17px;cursor:pointer;box-shadow:0 1px 2px rgba(37,95,159,.35),inset 0 1px 0 rgba(255,255,255,.22);
  transition:background .15s,transform .08s}
.btn:hover:not(:disabled){background:var(--blue-d)}
.btn:active:not(:disabled){transform:translateY(1px)}
.btn:disabled{opacity:.5;cursor:default}

/* ── map controls ── */
.tilt{position:absolute;right:14px;bottom:30px;z-index:11;display:flex;background:rgba(255,255,255,.94);
  backdrop-filter:blur(8px);border:1px solid rgba(236,230,222,.9);border-radius:10px;overflow:hidden;
  box-shadow:var(--e2),var(--lift)}
.tilt button{border:none;background:none;font:600 11.5px/1 inherit;color:var(--taupe);padding:9px 13px;cursor:pointer}
.tilt button[aria-pressed="true"]{background:var(--ink);color:#fff}
.hint{position:absolute;bottom:26px;left:50%;transform:translateX(-50%);z-index:11;
  background:rgba(255,255,255,.95);backdrop-filter:blur(8px);border:1px solid rgba(236,230,222,.9);
  border-radius:999px;padding:8px 18px;font-size:12.5px;color:var(--taupe);box-shadow:var(--e2),var(--lift);
  max-width:86vw;text-align:center}

/* ── parcel chooser ── */
.pick{position:absolute;top:80px;left:14px;z-index:11;width:376px;max-width:92vw;max-height:66vh;overflow-y:auto;
  background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:var(--e3),var(--lift)}
.pick>h2{margin:0;padding:14px 17px;font:600 12.5px/1.45 inherit;color:var(--taupe);border-bottom:1px solid var(--hair)}
.pick button{display:block;width:100%;text-align:left;border:none;border-bottom:1px solid var(--hair);
  background:none;padding:12px 17px;cursor:pointer;transition:background .12s}
.pick button:hover{background:var(--cream)}
.pick button b{display:block;font:600 14px/1.3 inherit;color:var(--ink)}
.pick button span{font-size:12px;color:var(--mute)}

/* ── the dossier ── */
.dz{position:absolute;top:80px;left:14px;z-index:11;width:462px;max-width:94vw;max-height:calc(100dvh - 104px);
  display:flex;flex-direction:column;background:var(--paper);border-radius:17px;
  box-shadow:var(--e3);overflow:hidden}
.grab{display:none}
.dz-scroll{overflow-y:auto;overscroll-behavior:contain}

/* verdict — the one dark register in the product, so the judgement reads as a
   different kind of thing from the evidence underneath it */
.vd{position:relative;background:linear-gradient(167deg,#3a322a 0%,#262019 62%,#211b16 100%);color:#f6f0e7;padding:18px 20px 17px}
.vd::after{content:"";position:absolute;inset:0 0 auto;height:1px;background:rgba(255,255,255,.14)}
.vd-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.vd-where{font-size:11.5px;color:#b9ab99;letter-spacing:.01em}
.vd-addr{font-family:Georgia,"Times New Roman",serif;font-size:21px;line-height:1.22;margin:5px 0 0;font-weight:400}
.vd-meta{font-size:11.5px;color:#9d8f7d;margin-top:5px}
.vd-acts{display:flex;gap:6px;flex-shrink:0}
.icn{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#f6f0e7;border-radius:9px;
  height:31px;padding:0 11px;font:600 12px/1 inherit;cursor:pointer;transition:background .14s}
.icn:hover:not(:disabled){background:rgba(255,255,255,.17)}
.icn:disabled{opacity:.45;cursor:default}
.icn.x{width:31px;padding:0;font-size:16px}

.vd-read{display:flex;align-items:flex-end;gap:15px;margin:17px 0 0}
.vd-score{font-family:Georgia,serif;font-size:52px;line-height:.86;letter-spacing:-.025em}
.vd-score i{font-style:normal;font-size:16px;color:#8d8071}
.vd-call{flex:1;min-width:0;padding-bottom:3px}
.vd-call b{display:block;font-size:14.5px;font-weight:650;letter-spacing:-.01em}
.vd-call span{display:block;font-size:12.5px;line-height:1.5;color:#b9ab99;margin-top:3px}

.sigs{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:16px 0 0}
.sig{background:rgba(0,0,0,.26);border-radius:9px;padding:9px 10px;box-shadow:var(--well)}
.sig span{display:block;font-size:10.5px;color:#9d8f7d}
.sig b{display:block;font-size:13px;font-weight:650;margin-top:3px}

/* body */
.bd{padding:0 19px 20px}
.sec{margin-top:21px;padding-top:15px;border-top:1px solid var(--line)}
.sec>h3{margin:0 0 9px;font:650 13.5px/1.3 inherit;letter-spacing:-.01em;color:var(--ink)}
.sec>h3 em{font-style:normal;font-weight:500;color:var(--mute);font-size:12px}
.quiet{font-size:12.5px;line-height:1.55;color:var(--mute)}

.row{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid var(--hair);font-size:13px;line-height:1.45}
.row>span:first-child{color:var(--taupe);flex:0 1 auto}
.row>span:last-child{font-weight:500;text-align:right;color:var(--ink)}
.row:last-child{border-bottom:none}

.pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:600}
.pill.green{background:#e4f5e8;color:var(--good)} .pill.amber{background:#fdf0dc;color:var(--warn)}
.pill.red{background:#fdeaef;color:var(--bad)} .pill.gray{background:#f1ede7;color:var(--taupe)}

/* the advisor's voice — raised paper, serif, the one place prose gets room */
.read{margin-top:17px;background:#fff;border:1px solid var(--line);border-radius:13px;padding:16px 18px;
  box-shadow:var(--e1),var(--lift)}
.read h3{margin:0 0 8px;font:650 13px/1 inherit;display:flex;align-items:center;gap:8px}
.read .ai{font-size:9.5px;font-weight:600;background:#eaf3fc;color:var(--blue);padding:2.5px 7px;border-radius:999px}
.read p{margin:0;font-family:Georgia,serif;font-size:14.5px;line-height:1.68;white-space:pre-wrap}

/* next actions — recessed, because it is a worksheet rather than a finding */
.todo{margin-top:17px;background:var(--cream);border-radius:13px;padding:15px 17px;box-shadow:var(--well)}
.todo h3{margin:0 0 3px;font:650 13px/1 inherit}
.todo>p{margin:0 0 10px;font-size:12px;color:var(--taupe)}
.todo label{display:flex;gap:10px;align-items:flex-start;padding:7px 0;cursor:pointer;font-size:13px;line-height:1.5}
.todo label+label{border-top:1px solid #efe9e1}
.todo input{appearance:none;-webkit-appearance:none;flex:none;width:16px;height:16px;margin-top:1px;border-radius:5px;
  border:1.5px solid #cfc5b8;background:#fff;cursor:pointer;transition:background .14s,border-color .14s}
.todo input:checked{background:var(--blue);border-color:var(--blue)}
.todo input:checked+span{color:var(--mute);text-decoration:line-through}
.todo span{min-width:0}

.flagbox{background:#fff6ed;border:1px solid #f6d9b8;border-radius:11px;padding:11px 13px;margin-top:11px}
.flagbox b{display:block;font-size:12px;font-weight:650;color:#9a4a12;margin-bottom:5px}
.flagbox div{font-size:12.5px;line-height:1.52;color:#8a4414}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}
.chips span{font-size:11.5px;background:#fff;border:1px solid var(--line);border-radius:999px;padding:3.5px 10px;color:var(--taupe)}
.src{font-size:11px;color:var(--mute);margin-top:9px;line-height:1.5}
.note{font-size:11.5px;color:var(--mute);margin-top:8px;line-height:1.55}
.legal{margin-top:20px;padding:13px 15px;background:var(--cream);border-radius:11px;font-size:10.5px;
  line-height:1.6;color:var(--mute);box-shadow:var(--well)}
.legal b{color:var(--taupe)}

/* ── cold start ── */
.intro{position:absolute;inset:0;z-index:13;display:flex;align-items:center;justify-content:center;padding:20px;
  overflow-y:auto;background:linear-gradient(180deg,rgba(250,248,244,.82),rgba(250,248,244,.95));
  backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.card{width:100%;max-width:640px;background:var(--paper);border-radius:19px;padding:34px 36px;
  box-shadow:var(--e3),var(--lift);animation:rise .5s cubic-bezier(.2,.75,.3,1) both}
@keyframes rise{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}
.card h1{margin:0;font-family:Georgia,serif;font-weight:400;font-size:clamp(26px,4.3vw,37px);line-height:1.13;
  letter-spacing:-.015em}
.card>p{margin:13px 0 0;max-width:54ch;font-size:15px;line-height:1.6;color:var(--taupe)}
.field{display:flex;gap:9px;margin:23px 0 0}
.field input{flex:1;min-width:0;font:400 16px/1 inherit;color:var(--ink);background:#fff;border:1.5px solid var(--line);
  border-radius:12px;padding:15px 16px;outline:none;transition:border-color .15s,box-shadow .15s}
.field input::placeholder{color:var(--mute)}
.field input:focus{border-color:var(--blue);box-shadow:0 0 0 4px #eaf3fc}
.field .btn{padding:0 25px;font-size:15px}
.egs{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:14px 0 0;font-size:12.5px;color:var(--mute)}
.egs button{border:1px solid var(--line);background:var(--cream);border-radius:999px;padding:7px 13px;cursor:pointer;
  font:500 12.5px/1 inherit;color:var(--taupe);transition:border-color .15s,color .15s,background .15s}
.egs button:hover{border-color:var(--blue);color:var(--blue);background:#eaf3fc}
.gets{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:24px 0 0}
.get{background:#fff;border:1px solid var(--line);border-radius:11px;padding:13px 15px;box-shadow:var(--e1),var(--lift)}
.get b{display:block;font-size:13px;font-weight:650}
.get span{display:block;font-size:12px;line-height:1.45;color:var(--mute);margin-top:3px}
.foot{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;margin:21px 0 0;
  padding-top:16px;border-top:1px solid var(--hair);font-size:12px;color:var(--mute)}
.foot button{border:none;background:none;padding:0;cursor:pointer;font:500 12px/1.4 inherit;color:var(--blue)}
.foot button:hover{text-decoration:underline}

/* ── phone: the map is the context, the dossier is a sheet over it ── */
@media (max-width:680px){
  .dz,.pick{top:auto;bottom:0;left:0;right:0;width:auto;max-width:none;border-radius:19px 19px 0 0}
  .dz{max-height:84dvh} .pick{max-height:58dvh}
  .grab{display:block;position:sticky;top:0;z-index:4;background:var(--paper);padding:9px 0 3px;text-align:center}
  .grab::after{content:"";display:inline-block;width:38px;height:4px;border-radius:999px;background:#e2dace}
  .vd{border-radius:0}
  .dz-scroll{padding-bottom:env(safe-area-inset-bottom)}
  .tilt{bottom:auto;top:76px}
  .hint{bottom:auto;top:76px;left:14px;right:14px;transform:none;max-width:none}
}
@media (max-width:560px){
  .card{padding:26px 21px;border-radius:17px}
  .field{flex-direction:column} .field .btn{padding:15px 25px}
  .gets{grid-template-columns:1fr}
  .vd-score{font-size:44px}
}
@media (prefers-reduced-motion:reduce){ .card{animation:none} .k2 *{transition:none!important} }
`;

export default function Home() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("Search an address or APN, or tap the map.");
  const [matches, setMatches] = useState<Match[]>([]);
  const [sel, setSel] = useState<Match | null>(null);
  const [report, setReport] = useState<any>(null);
  const [repBusy, setRepBusy] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [anaBusy, setAnaBusy] = useState(false);
  const [aiFlag, setAiFlag] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [actBusy, setActBusy] = useState(false);
  const [actEnabled, setActEnabled] = useState(true);
  const [actSources, setActSources] = useState<string[]>([]);
  const [zoning, setZoning] = useState<any>(null);
  const [znBusy, setZnBusy] = useState(false);
  const [znSources, setZnSources] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [intro, setIntro] = useState(true);
  const [ctx, setCtx] = useState<any>(null);
  const [ctxBusy, setCtxBusy] = useState(false);
  const [embed, setEmbed] = useState(false);
  const [brand, setBrand] = useState<string>("");
  const [tilted, setTilted] = useState(true);
  const [done, setDone] = useState<Set<string>>(new Set());
  const tiltRef = useRef(true);

  useEffect(() => { try { const sp = new URLSearchParams(window.location.search); setEmbed(sp.get("embed") === "1" || sp.get("embed") === "true"); setBrand(sp.get("brand") || ""); } catch { } }, []);

  useEffect(() => {
    if (mapRef.current || !boxRef.current) return;
    const m = new maplibregl.Map({ container: boxRef.current, style: STYLE, center: [-119.4, 37.15], zoom: 5.5, antialias: true });
    mapRef.current = m;
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    m.on("load", () => {
      m.resize(); setReady(true);
      m.addSource("p", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      // Flat wash for the plan view; an extruded block for the tilted one. The parcel reads
      // as a solid volume of land rather than a shape drawn on a picture of the ground.
      m.addLayer({ id: "pf", type: "fill", source: "p", paint: { "fill-color": "#2f74c0", "fill-opacity": 0.22 } });
      m.addLayer({
        id: "pe", type: "fill-extrusion", source: "p",
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": "#3d82cc",
          "fill-extrusion-height": ["get", "h"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.62,
        },
      });
      m.addLayer({ id: "pl", type: "line", source: "p", paint: { "line-color": "#1d4ed8", "line-width": 2.2 } });
    });
    m.on("error", e => console.warn("map", e?.error?.message || e));
    m.on("click", e => { void lookupPoint(e.lngLat.lat, e.lngLat.lng); });
    return () => { m.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion:reduce)").matches;

  function applyTilt(on: boolean) {
    const m = mapRef.current; if (!m) return;
    tiltRef.current = on; setTilted(on);
    try {
      if (m.getLayer("pe")) m.setLayoutProperty("pe", "visibility", on ? "visible" : "none");
      if (m.getLayer("pf")) m.setLayoutProperty("pf", "visibility", on ? "none" : "visible");
    } catch { }
    m.easeTo({ pitch: on ? 52 : 0, bearing: on ? -17 : 0, duration: reduced() ? 0 : 650 });
  }

  function draw(g: GeoJSON.Geometry | null, acres?: number) {
    const m = mapRef.current, src = m?.getSource("p") as maplibregl.GeoJSONSource | undefined;
    if (!src || !m) return;
    if (!g) {
      src.setData({ type: "FeatureCollection", features: [] });
      m.easeTo({ pitch: 0, bearing: 0, duration: reduced() ? 0 : 500 });
      return;
    }
    // Plinth height is a modelling scale, not a measurement: it keeps a quarter-acre lot and a
    // forty-acre ranch both legible as solids at their own zoom.
    const h = Math.round(Math.min(70, Math.max(9, 7 * Math.sqrt(Math.max(0.05, acres || 1)))));
    src.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { h }, geometry: g }] });
    const b = new maplibregl.LngLatBounds(), gg = g as any;
    (gg.type === "Polygon" ? [gg.coordinates] : gg.coordinates).forEach((pl: any) => pl.forEach((r: any) => r.forEach((c: any) => b.extend(c))));
    if (b.isEmpty()) return;
    const wide = typeof window !== "undefined" && window.innerWidth > 680;
    const pad = { top: wide ? 100 : 90, bottom: wide ? 60 : Math.round((typeof window !== "undefined" ? window.innerHeight : 800) * 0.5), left: wide ? 500 : 40, right: 60 };
    const on = tiltRef.current;
    try {
      const cam: any = m.cameraForBounds(b, { padding: pad, maxZoom: on ? 16.4 : 17 });
      // One orchestrated move: frame, tilt and turn resolve together rather than in sequence.
      if (cam) m.easeTo({ ...cam, pitch: on ? 52 : 0, bearing: on ? -17 : 0, duration: reduced() ? 0 : 1050, essential: true });
      else m.fitBounds(b, { padding: pad, maxZoom: 17 });
    } catch { m.fitBounds(b, { padding: pad, maxZoom: 17 }); }
  }

  async function choose(mt: Match) {
    try {
      const c = centroid(mt.geometry);
      setCtx(null); setCtxBusy(true);
      fetch(`/api/context?lat=${c[1]}&lon=${c[0]}`).then(r => r.json())
        .then(d => setCtx(d)).catch(() => setCtx(null)).finally(() => setCtxBusy(false));
    } catch { setCtxBusy(false); }
    setSel(mt); setMatches([]); setDone(new Set()); draw(mt.geometry, mt.acreage);
    setMsg(`${mt.label} County — ${mt.address || mt.apn}`);
    setReport(null); setRepBusy(true); setAnalysis(null);
    const [lon, lat] = centroid(mt.geometry as any);
    const cSlug = mt.label === "Napa" ? "napa" : mt.label === "Los Angeles" ? "los_angeles" : mt.label.toLowerCase().replace(/\s+/g, "_");
    const zoneQ = mt.zoning ? `&zone=${encodeURIComponent(mt.zoning)}` : "";
    const zdescQ = mt.zoning_description ? `&zdesc=${encodeURIComponent(mt.zoning_description)}` : "";
    let rep: any = null;
    try {
      const r = await fetch(`/api/feasibility?lon=${lon}&lat=${lat}&acres=${mt.acreage}&county=${cSlug}${zoneQ}${zdescQ}`);
      rep = await r.json(); setReport(rep);
    } catch { setReport({ error: true }); }
    finally { setRepBusy(false); }
    setAnaBusy(true);
    try {
      const uCode = pickVal(mt.attrs, ["usedesc", "UseCodeDescription", "landuse1", "LANDUSE", "UseType", "use_code", "usecode", "LandUse"]);
      const assessed = money(assessedTotal(mt.attrs));
      const landv = money(pickVal(mt.attrs, ["Roll_LandValue", "Value601Land", "LandValue", "land_val", "LAND_VAL", "land_value", "landval"]));
      const ar = await fetch("/api/analysis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: mt.address, apn: mt.apn, acreage: mt.acreage, county: mt.label, buildability: rep?.buildability, risk: rep?.risk, useCode: uCode, assessed, land: landv }) });
      const aj = await ar.json(); setAnalysis(aj.narrative || null); setAiFlag(!!aj.ai);
    } catch { setAnalysis(null); }
    finally { setAnaBusy(false); }
    setActBusy(true); setActivity(null);
    setZnBusy(true); setZoning(null); setZnSources([]);
    const actP = fetch("/api/activity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: mt.address, county: mt.label, apn: mt.apn }) })
      .then(r => r.json()).then(aj => { setActEnabled(aj.enabled !== false); setActivity(aj.briefing || null); setActSources(aj.sources || []); })
      .catch(() => setActivity(null)).finally(() => setActBusy(false));
    const znP = fetch("/api/zoning", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: mt.address, county: mt.label, apn: mt.apn, acreage: mt.acreage, zoning: mt.zoning || rep?.zone?.code || null, zoneDesc: rep?.zone?.name || null, lat, lon, flood: rep?.risk?.flood?.label || null, fire: rep?.risk?.fire?.label || null, williamson: rep?.risk?.williamson?.label || null, terrain: rep?.risk?.terrain?.label || null }) })
      .then(r => r.json()).then(zj => { setZoning(zj.report || null); setZnSources(zj.sources || []); })
      .catch(() => setZoning(null)).finally(() => setZnBusy(false));
    await Promise.allSettled([actP, znP]);
  }

  async function run(url: string, label: string) {
    setIntro(false); setBusy(true); setSel(null); setMatches([]); setReport(null); setMsg(label);
    try {
      const r = await fetch(url); const d = await r.json();
      if (d.status === "ok" && d.matches?.length) {
        const near = d.match === "nearby" || d.match === "approximate";
        const street = d.match === "street";
        if (d.matches.length === 1 && !near && !street) { choose(d.matches[0]); }
        else {
          setMatches(d.matches); draw(null);
          setMsg(near ? "No address on file for that number. These are the parcels at that spot, nearest first."
            : street ? "That number isn't in the county address book. These are the lots on that road."
            : `${d.matches.length} parcels match. Pick yours.`);
        }
      } else { draw(null); setMsg(d.message || "No parcel found."); }
    } catch { setMsg("Search failed — try again."); }
    finally { setBusy(false); }
  }
  const lookupPoint = (lat: number, lon: number) => run(`/api/parcel?lat=${lat}&lon=${lon}`, "Fetching parcel…");
  const search = () => { const q = addr.trim(); if (q) run(`/api/parcel?q=${encodeURIComponent(q)}`, "Searching California records…"); };
  const tryExample = (q: string) => { setAddr(q); run(`/api/parcel?q=${encodeURIComponent(q)}`, "Searching California records…"); };

  /* ── derived read ── */
  const b = report?.buildability, rk = report?.risk;
  const u = b?.maxUnits;
  const potential = u == null ? { t: "—", c: "gray" } : u >= 5 ? { t: "Premium", c: "green" } : u >= 2 ? { t: "Strong", c: "green" } : u === 1 ? { t: "Single home", c: "amber" } : { t: "Limited", c: "amber" };
  const riskFlags = [rk?.flood, rk?.fire, rk?.williamson, rk?.terrain].filter(Boolean) as any[];
  const anyRed = riskFlags.some(f => f.level === "red");
  const anyAmber = riskFlags.some(f => f.level === "amber");
  const regRisk = !report ? { t: "—", c: "gray" } : anyRed ? { t: "High", c: "red" } : anyAmber ? { t: "Medium", c: "amber" } : { t: "Low", c: "green" };
  const demand = !actEnabled ? { t: "—", c: "gray" } : (actBusy && !activity) ? { t: "…", c: "gray" } : activity && /data center|industrial|warehouse|logistics|growth|expansion|boom|corridor|construction|development|approved|proposed/i.test(activity) ? { t: "Strong", c: "green" } : activity ? { t: "Moderate", c: "amber" } : { t: "Quiet", c: "gray" };
  let score = 55;
  if (u != null) score += Math.min(24, u * 4);
  if (rk?.flood?.level === "red") score -= 16;
  if (rk?.fire) { if (/very high/i.test(rk.fire.text)) score -= 12; else if (/high/i.test(rk.fire.text)) score -= 7; else if (rk.fire.level === "amber") score -= 3; }
  if (rk?.williamson?.level === "red") score -= 20;
  if (rk?.terrain?.level === "amber") score -= 3;
  if (demand.t === "Strong") score += 8; else if (demand.t === "Moderate") score += 3;
  score = Math.max(12, Math.min(97, Math.round(score)));
  const via = score >= 80 ? { t: "High viability", c: "#16a34a" } : score >= 62 ? { t: "Solid", c: "#2563eb" } : score >= 45 ? { t: "Moderate", c: "#b45309" } : { t: "Challenged", c: "#dc2626" };

  const sale = sel ? saleHistory(sel.attrs) : null;
  const juris = sel ? jurisdiction(sel.attrs, sel.label) : null;
  const tax = sel ? taxNote(sel.attrs) : null;
  const wc = sel ? williamsonContract(sel.attrs) : null;
  const val = sel ? money(assessedTotal(sel.attrs)) : null;
  const land = sel ? money(pickVal(sel.attrs, ["Roll_LandValue", "Value601Land", "LandValue", "land_val", "LAND_VAL", "land_value", "landval"])) : null;
  const useCode = sel ? pickVal(sel.attrs, ["usedesc", "UseCodeDescription", "landuse1", "LANDUSE", "UseType", "use_code", "usecode", "LandUse"]) : null;

  // The headline, written the way an advisor would open: the call, then the reason for it.
  function verdictLine(): string {
    if (!report) return "Pulling the county record.";
    const blockers: string[] = [];
    if (rk?.williamson?.level === "red") blockers.push("a Williamson Act contract");
    if (rk?.flood?.level === "red") blockers.push("a FEMA flood zone");
    if (rk?.fire && /very high|high/i.test(rk.fire.text)) blockers.push("high fire hazard");
    if (!b?.code) blockers.push("unconfirmed zoning");
    const lead = score >= 80 ? "Worth a closer look." : score >= 62 ? "Workable, with conditions." : score >= 45 ? "Proceed carefully." : "Difficult as zoned.";
    if (!blockers.length) return `${lead} Nothing on the public record blocks development here.`;
    const list = blockers.length === 1 ? blockers[0] : blockers.slice(0, -1).join(", ") + " and " + blockers[blockers.length - 1];
    return `${lead} The record flags ${list}.`;
  }

  // Everything a buyer still has to go and confirm, derived from what the record did and
  // didn't answer. This is the part of the job the data cannot finish.
  function verifySteps(): string[] {
    if (!sel || !report) return [];
    const s: string[] = [];
    const who = juris?.body || `${sel.label} County planning department`;
    if (!b?.code || !zoning?.zone) s.push(`Confirm the zoning district and any overlays with ${who}.`);
    if (juris && !juris.known) s.push(`Confirm whether this parcel is inside city limits — that decides which counter reviews a project.`);
    if (rk?.fire && /very high|high/i.test(rk.fire.text)) s.push(`Get a written insurance quote before the contingency expires — the parcel sits in a ${rk.fire.text.toLowerCase()} zone.`);
    if (rk?.flood?.level === "red") s.push("Order an elevation certificate; FEMA maps this inside a Special Flood Hazard Area.");
    if (wc) s.push(`Request the Williamson Act contract${wc.no ? ` (${wc.no})` : ""} and its non-renewal status in writing.`);
    else if (rk?.williamson?.level === "red") s.push("Request the Williamson Act contract and its non-renewal status in writing.");
    if (tax?.prop8) s.push("Ask the assessor why the roll carries a reduced value — it usually follows damage or a market decline.");
    if (rk?.terrain?.level === "amber") s.push("Order a topographic survey and confirm legal access.");
    const hasStructure = !!pickVal(sel.attrs, ["YearBuilt1", "BuildingPrimaryYearBuilt", "YearBuilt", "SQFTmain1", "BuildingPrimarySize"]);
    if (!hasStructure) s.push("Confirm well, septic and utility feasibility — no structures are on record.");
    s.push("Pull a preliminary title report for easements and recorded restrictions.");
    return s;
  }
  const steps = verifySteps();

  async function downloadPDF() {
    if (!sel) return;
    const { jsPDF } = await import("jspdf");
    const doc: any = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210, M = 15; let y = 0;
    const V = (n: string[]) => money(pickVal(sel.attrs, n));
    const vAssessed = money(assessedTotal(sel!.attrs));
    const vLand = V(["Roll_LandValue", "Value601Land", "LandValue", "land_val", "LAND_VAL", "land_value", "landval"]);
    const uCode = useCode;
    const bb = report?.buildability || {}, rr = report?.risk || {};
    try {
      const blob = await (await fetch("/k2-logo.png")).blob();
      const durl: string = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob); });
      doc.addImage(durl, "PNG", M, 6, 15, 15);
    } catch { }
    doc.setTextColor(42, 36, 32); doc.setFont("times", "normal"); doc.setFontSize(19); doc.text("K2 Investment", M + 19, 13.5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(47, 116, 192); doc.text("PROPERTY RECORD", M + 19, 19);
    doc.setTextColor(168, 158, 148); doc.setFontSize(8); doc.text(new Date().toLocaleDateString(), W - M, 13.5, { align: "right" });
    doc.setDrawColor(236, 230, 222); doc.setLineWidth(0.4); doc.line(M, 25, W - M, 25);
    y = 38;
    doc.setTextColor(42, 36, 32); doc.setFont("times", "normal"); doc.setFontSize(17);
    doc.text(sel.address || "Vacant parcel (no address on file)", M, y);
    drawShape(doc, sel.geometry, W - M - 46, 30, 46, 34);
    y += 7; doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(125, 114, 103);
    doc.text(`APN ${sel.apn}    ${sel.label} County    ${sel.acreage} acres`, M, y);
    if (report) {
      y += 8;
      doc.setFillColor(250, 248, 244); doc.setDrawColor(236, 230, 222); doc.roundedRect(M, y, 44, 28, 2, 2, "FD");
      doc.setTextColor(42, 36, 32); doc.setFont("times", "normal"); doc.setFontSize(24); doc.text(String(score), M + 22, y + 15, { align: "center" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(168, 158, 148); doc.text("COMPOSITE READ /100", M + 22, y + 21, { align: "center" });
      const kx = M + 54, kw = (W - M - kx) / 3;
      ([["Development", potential.t], ["Regulatory risk", regRisk.t], ["Market demand", demand.t]] as [string, string][]).forEach((k, i) => {
        const x = kx + i * kw;
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(168, 158, 148); doc.text(k[0], x, y + 9);
        doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(42, 36, 32); doc.text(k[1], x, y + 20);
      });
      y += 34;
      doc.setFont("times", "normal"); doc.setFontSize(11); doc.setTextColor(42, 36, 32);
      doc.splitTextToSize(verdictLine(), W - 2 * M).forEach((ln: string) => { doc.text(ln, M, y); y += 5; });
    }
    const sec = (t: string) => { if (y > 250) { doc.addPage(); y = 20; } y += 8; doc.setDrawColor(236, 230, 222); doc.line(M, y, W - M, y); y += 6; doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(168, 158, 148); doc.text(t.toUpperCase(), M, y); y += 6.5; doc.setFont("helvetica", "normal"); doc.setFontSize(10); };
    const row = (k: string, v: any, c?: number[]) => { if (y > 278) { doc.addPage(); y = 20; } doc.setTextColor(125, 114, 103); doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text(k, M, y); const col = c || [42, 36, 32]; doc.setTextColor(col[0], col[1], col[2]); doc.text(String(v), W - M, y, { align: "right" }); y += 6.6; };
    const RC: Record<string, number[]> = { green: [21, 128, 61], amber: [180, 83, 9], red: [190, 18, 60], gray: [100, 116, 139] };
    if (analysis) {
      y += 10; doc.setDrawColor(226, 232, 240); doc.line(M, y, W - M, y); y += 6;
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(168, 158, 148); doc.text("THE READ" + (aiFlag ? "  (AI)" : ""), M, y); y += 6;
      doc.setFont("times", "normal"); doc.setFontSize(11); doc.setTextColor(42, 36, 32);
      doc.splitTextToSize(analysis.replace(/\*\*/g, ""), W - 2 * M).forEach((ln: string) => { if (y > 276) { doc.addPage(); y = 20; } doc.text(ln, M, y); y += 5; });
    }
    if (steps.length) {
      sec("Before you offer");
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(42, 36, 32);
      steps.forEach(s => { doc.splitTextToSize("☐  " + s, W - 2 * M).forEach((ln: string) => { if (y > 276) { doc.addPage(); y = 20; } doc.text(ln, M, y); y += 5; }); y += 1; });
    }
    if (juris) {
      sec("Jurisdiction");
      if (juris.status) row("Land status", juris.status);
      row("Who reviews a project here", juris.body);
      if (juris.mailCity) row("Mailing city", String(juris.mailCity));
      if (juris.district) row("Supervisor district", `${juris.district}${juris.supervisor ? ` — ${juris.supervisor}` : ""}`);
      if (juris.taxArea) row("Tax rate area", String(juris.taxArea));
    }
    sec("Zoning on record");
    row("Zoning district", bb.code || "Not returned");
    if (bb.name) row("District", bb.name); if (bb.use) row("Primary use", bb.use); if (bb.minLot) row("Min lot / density", bb.minLot);
    row("Density allowance on record", bb.maxUnits != null ? bb.maxUnits : "—", [37, 99, 235]);
    if (bb.envelope) row("Est. buildable footprint", bb.envelope.toLocaleString() + " sf");
    row("ADU allowance", "State law generally permits ADUs - confirm locally");
    if (zoning) {
      sec("Zoning & Entitlement Intelligence" + (zoning.confidence ? `  (${zoning.confidence} confidence)` : ""));
      if (zoning.zone) row("Governing zone", zoning.zone);
      if (zoning.jurisdiction) row("Jurisdiction", zoning.jurisdiction);
      if (zoning.summary) { doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(30, 41, 59); doc.splitTextToSize(zoning.summary, W - 2 * M).forEach((ln: string) => { if (y > 276) { doc.addPage(); y = 20; } doc.text(ln, M, y); y += 5; }); }
      if (Array.isArray(zoning.standards)) zoning.standards.filter((s: any) => s && s.value).forEach((s: any) => row(s.label, String(s.value)));
      const para = (lab: string, txt: string) => { if (!txt) return; if (y > 270) { doc.addPage(); y = 20; } y += 1.5; doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(47, 116, 192); doc.text(lab, M, y); y += 5; doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(30, 41, 59); doc.splitTextToSize(txt, W - 2 * M).forEach((ln: string) => { if (y > 276) { doc.addPage(); y = 20; } doc.text(ln, M, y); y += 5; }); };
      para("ADUs", zoning.adu); para("Upside", zoning.opportunities); para("Process", zoning.process);
      if (Array.isArray(zoning.flags) && zoning.flags.length) { if (y > 268) { doc.addPage(); y = 20; } y += 1.5; doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(194, 65, 12); doc.text("Could stop or delay a deal", M, y); y += 5; doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(154, 52, 18); zoning.flags.forEach((f: string) => { doc.splitTextToSize("- " + f, W - 2 * M).forEach((ln: string) => { if (y > 276) { doc.addPage(); y = 20; } doc.text(ln, M, y); y += 5; }); }); }
      if (znSources && znSources.length) { if (y > 274) { doc.addPage(); y = 20; } doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184); doc.text("Zoning sources: " + znSources.join(", "), M, y); y += 5; }
    }
    sec("Hazards & constraints");
    ([["Flood zone (FEMA)", "flood"], ["Fire hazard", "fire"], ["Williamson Act", "williamson"], ["Terrain", "terrain"]] as const).forEach(([lab, k]) => { const r = rr[k as string]; row(lab, r ? r.text : "—", r ? RC[r.level] : undefined); });
    if (wc) {
      if (wc.no) row("Contract number", String(wc.no));
      if (wc.eff) row("Contract effective", monthYear(wc.eff));
      if (wc.exp) row("Contract expires", monthYear(wc.exp));
      row("Non-renewal filed", wc.nonRenewal ? "Yes" : "No");
    }
    if (sale?.any) {
      sec("Ownership & sale history");
      if (sale.price && sale.date) row("Last recorded sale", `${money(sale.price)} — ${monthYear(sale.date)}`);
      else if (sale.date) row("Last recorded sale", monthYear(sale.date));
      if (sale.pPrice && sale.pDate) row("Prior sale", `${money(sale.pPrice)} — ${monthYear(sale.pDate)}`);
      if (sale.annual != null && sale.held != null) row("Change between sales", `${sale.annual >= 0 ? "+" : ""}${sale.annual.toFixed(1)}% a year over ${sale.held.toFixed(0)} years`);
      if (sale.sinceLast != null) row("Held since last sale", `${sale.sinceLast.toFixed(0)} years`);
      if (sale.price && sel.acreage) row("Last sale per acre", String(money(sale.price / sel.acreage)));
    }
    sec("Value & tax basis");
    if (uCode) row("Land use (county code)", String(uCode));
    row("Assessed value", vAssessed || (exemptish(sel.attrs) ? "Tax-exempt parcel - not assessed" : "Not published by this county"));
    row("Assessed land value", vLand || (exemptish(sel.attrs) ? "Tax-exempt parcel - not assessed" : "Not published by this county"));
    if (vAssessed) row("Assessed per acre", String(money((assessedTotal(sel.attrs) || 0) / sel.acreage)));
    if (tax) row("Assessment status", tax.text);
    {
      const yr = pickVal(sel.attrs, ["YearBuilt1", "BuildingPrimaryYearBuilt", "YearBuilt", "EffectiveYear1", "yearbuilt"]);
      const sq = pickVal(sel.attrs, ["SQFTmain1", "BuildingPrimarySize", "SQFTmain", "BuildingArea", "sqft", "LivingArea"]);
      const bd = pickVal(sel.attrs, ["Bedrooms1", "BuildingPrimaryBedRooms", "Bedrooms", "BEDROOMS", "NBR_BEDROOMS"]);
      const ba = pickVal(sel.attrs, ["Bathrooms1", "BuildingPrimaryBaths", "Bathrooms", "BATHROOMS"]);
      const un = pickVal(sel.attrs, ["Units1", "BuildingPrimaryUnitCount", "Units", "NBR_UNITS"]);
      const ud = pickVal(sel.attrs, ["UseDescription", "UseCodeDescription", "UseType", "AssessDescription", "usedesc"]);
      const imp = money(pickVal(sel.attrs, ["Roll_ImpValue", "Value601Structure", "ImpValue", "improvval", "ImprovementValue"]));
      if (yr || sq || bd || ba || un || ud || imp) {
        sec("Structure & assessor record");
        if (ud) row("Use on record", String(ud));
        if (yr) row("Year built", String(yr));
        if (sq) row("Building area", Number(sq).toLocaleString() + " sf");
        if (bd || ba) row("Bedrooms / bathrooms", `${bd ?? "—"} / ${ba ?? "—"}`);
        if (un) row("Units on record", String(un));
        if (imp) row("Improvement value", imp);
      }
    }
    if (ctx && (ctx.communityPlan || ctx.tract || ctx.demographics || ctx.schools || ctx.hospitals)) {
      sec("Neighborhood");
      if (ctx.communityPlan) row("Community plan area", String(ctx.communityPlan));
      if (ctx.tract) row("Census tract", String(ctx.tract));
      if (Array.isArray(ctx.demographics)) ctx.demographics.forEach((d: any) => row(d.label, d.value));
      (["schools", "colleges", "hospitals"] as const).forEach(k => {
        const list = ctx[k]; if (!Array.isArray(list) || !list.length) return;
        const title = k === "schools" ? "Nearest public schools" : k === "colleges" ? "Colleges nearby" : "Nearest hospitals";
        if (y > 262) { doc.addPage(); y = 20; }
        y += 1.5; doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(168, 158, 148); doc.text(title.toUpperCase(), M, y); y += 5.5;
        list.forEach((x: any) => row(x.name + (x.sub ? ` · ${x.sub}` : ""), x.distance));
      });
      if (Array.isArray(ctx.sources) && ctx.sources.length) {
        if (y > 274) { doc.addPage(); y = 20; }
        doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); doc.setTextColor(168, 158, 148);
        doc.text("Sources: " + ctx.sources.join(", "), M, y); y += 5;
      }
    }
    if (analysis && activity) {
      sec("Area activity");
      doc.setFont("times", "normal"); doc.setFontSize(10.5); doc.setTextColor(42, 36, 32);
      doc.splitTextToSize(activity, W - 2 * M).forEach((ln: string) => { if (y > 276) { doc.addPage(); y = 20; } doc.text(ln, M, y); y += 5; });
    }
    if (y > 270) { doc.addPage(); y = 20; } else { y += 6; }
    doc.setDrawColor(226, 232, 240); doc.line(M, y, W - M, y); y += 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(168, 158, 148);
    doc.text(doc.splitTextToSize("DISCLAIMER: This report is for informational purposes only and is not legal, financial, investment, tax, or land-use advice, an appraisal, or a recommendation to transact. Data comes from public county, state, and federal sources and may be incomplete or outdated; portions are AI-generated and may contain errors. Verify all zoning, overlays, hazards, and development standards with the applicable planning department before any decision. K2 Investment makes no warranty of accuracy and accepts no liability for reliance on this report. Consult licensed professionals before purchasing or developing land.", W - 2 * M), M, y);
    doc.save(`K2-Property-Record-${sel.apn.replace(/[^\w]/g, "")}.pdf`);
  }

  const Row = ({ k, v }: { k: string; v: any }) => (<div className="row"><span>{k}</span><span>{v}</span></div>);
  const toggle = (s: string) => setDone(p => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; });

  return (
    <div className="k2">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div ref={boxRef} className="k2-map" />

      <div className="bar">
        {!embed ? (
          <a className="mark" href="/">
            <img src="/k2-logo.png" alt="" />
            {brand
              ? <b>{brand}<small>powered by K2 Investment</small></b>
              : <b>K2 <i>Investment</i></b>}
            <span className="tag">California</span>
          </a>
        ) : <span />}
        {!intro && (
          <div className="find">
            <input value={addr} onChange={e => setAddr(e.target.value)} onKeyDown={e => { if (e.key === "Enter") search(); }}
              placeholder="Address or APN, anywhere in California" aria-label="California address or APN" />
            <button className="btn" onClick={search} disabled={busy}>{busy ? "…" : "Analyze"}</button>
          </div>
        )}
      </div>

      {intro && (
        <div className="intro" role="dialog" aria-label="Start a parcel analysis">
          <div className="card">
            <h1>Everything on record,<br />before you write the offer.</h1>
            <p>Enter a California address or APN. You get the parcel record, the zoning on file, live flood and fire data, and a written read of what it all means — with the open questions a buyer still has to answer.</p>

            <div className="field">
              <input value={addr} autoFocus onChange={e => setAddr(e.target.value)} onKeyDown={e => { if (e.key === "Enter") search(); }}
                placeholder="4100 Mountain Home Ranch Rd, Calistoga" aria-label="California address or APN" />
              <button className="btn" onClick={search} disabled={busy}>{busy ? "Analyzing…" : "Analyze"}</button>
            </div>

            <div className="egs">
              Try one
              {["55 Longhorn Ridge Rd, Napa", "4100 Mountain Home Ranch Rd, Calistoga", "200 N Spring St, Los Angeles"].map(x => (
                <button key={x} onClick={() => tryExample(x)}>{x}</button>
              ))}
            </div>

            <div className="gets">
              {[["The call", "a composite read, and the one line that explains it"],
                ["Before you offer", "what still has to be verified, and with whom"],
                ["Zoning & hazards", "district, density, FEMA flood, CAL FIRE, Williamson Act"],
                ["Value & history", "assessed value, recorded sales, tax basis"]].map(([t, d]) => (
                <div className="get" key={t}><b>{t}</b><span>{d}</span></div>
              ))}
            </div>

            <div className="foot">
              <span>11 California counties live, expanding statewide</span>
              <button onClick={() => setIntro(false)}>Skip and explore the map</button>
            </div>
          </div>
        </div>
      )}

      {!intro && !sel && matches.length === 0 && (
        <div className="hint">{!ready ? "Loading map…" : msg}</div>
      )}

      {!intro && (
        <div className="tilt" role="group" aria-label="Map view">
          <button onClick={() => applyTilt(false)} aria-pressed={!tilted}>Plan</button>
          <button onClick={() => applyTilt(true)} aria-pressed={tilted}>Site</button>
        </div>
      )}

      {matches.length > 0 && (
        <div className="pick">
          <div className="grab" aria-hidden="true" />
          <h2>{msg}</h2>
          {matches.map((m, i) => (
            <button key={i} onClick={() => choose(m)}>
              <b>{m.address || "No address on file"}</b>
              <span>APN {m.apn} · {m.acreage} acres</span>
            </button>
          ))}
        </div>
      )}

      {sel && (
        <aside className="dz" aria-label="Property record">
          <div className="grab" aria-hidden="true" />
          <header className="vd">
            <div className="vd-top">
              <div style={{ minWidth: 0 }}>
                <div className="vd-where">{sel.label} County{juris?.status ? ` — ${juris.status.replace("Unincorporated county land", "unincorporated")}` : ""}</div>
                <h2 className="vd-addr">{sel.address || "Vacant — no address on file"}</h2>
                <div className="vd-meta">APN {sel.apn} · {sel.acreage} acres</div>
              </div>
              <div className="vd-acts">
                <button className="icn" onClick={downloadPDF} disabled={repBusy} title="Download the full record as a PDF">PDF</button>
                <button className="icn x" aria-label="Close record" onClick={() => { setSel(null); setReport(null); draw(null); setMsg("Search an address or APN, or tap the map."); }}>×</button>
              </div>
            </div>

            <div className="vd-read">
              <div className="vd-score">{report ? score : "—"}<i>/100</i></div>
              <div className="vd-call">
                <b style={{ color: report ? via.c : "#b9ab99" }}>{report ? via.t : "Reading the record"}</b>
                <span>{verdictLine()}</span>
              </div>
            </div>

            <div className="sigs">
              {([["Development", potential], ["Risk", regRisk], ["Demand", demand]] as [string, { t: string; c: string }][]).map(([lab, k]) => (
                <div className="sig" key={lab}>
                  <span>{lab}</span>
                  <b style={{ color: k.c === "green" ? "#86e0a3" : k.c === "amber" ? "#f0c48a" : k.c === "red" ? "#f4a3b4" : "#b9ab99" }}>{k.t}</b>
                </div>
              ))}
            </div>
          </header>

          <div className="dz-scroll">
            <div className="bd">
              <div className="read">
                <h3>The read {aiFlag && <span className="ai">AI</span>}</h3>
                {anaBusy && !analysis ? <p style={{ fontFamily: "inherit", fontSize: 13, color: "var(--mute)" }}>Reading the parcel…</p>
                  : analysis ? <p>{analysis.replace(/\*\*/g, "")}</p>
                  : <p style={{ fontFamily: "inherit", fontSize: 13, color: "var(--mute)" }}>Analysis unavailable for this parcel.</p>}
              </div>

              {steps.length > 0 && (
                <div className="todo">
                  <h3>Before you offer</h3>
                  <p>Drawn from what the record left open. Tick them off as you clear them.</p>
                  {steps.map(s => (
                    <label key={s}>
                      <input type="checkbox" checked={done.has(s)} onChange={() => toggle(s)} />
                      <span>{s}</span>
                    </label>
                  ))}
                </div>
              )}

              {juris && (juris.status || juris.district || juris.taxArea) && (
                <section className="sec">
                  <h3>Jurisdiction</h3>
                  {juris.status && <Row k="Land status" v={juris.status} />}
                  <Row k="Who reviews a project" v={juris.url ? <a href={String(juris.url)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue)" }}>{juris.body}</a> : juris.body} />
                  {juris.mailCity && <Row k="Mailing city" v={String(juris.mailCity)} />}
                  {juris.district && <Row k="Supervisor district" v={`${juris.district}${juris.supervisor ? ` — ${juris.supervisor}` : ""}`} />}
                  {juris.taxArea && <Row k="Tax rate area" v={String(juris.taxArea)} />}
                  <div className="note">A city mailing address does not mean city jurisdiction. Confirm the reviewing agency before you rely on any zoning figure below.</div>
                </section>
              )}

              <section className="sec">
                <h3>Zoning on record</h3>
                {repBusy && !report ? <div className="quiet">Reading zoning…</div>
                  : b?.error ? <div className="quiet">The zoning layer didn&apos;t respond. Verify with the county.</div> : (<>
                    <Row k="Zoning district" v={b?.code ? <span className="pill gray">{b.code}</span> : <span className="pill amber">not returned</span>} />
                    {b?.name && <Row k="District" v={b.name} />}
                    {b?.use && <Row k="Primary use" v={b.use} />}
                    {b?.minLot && <Row k="Min. parcel size" v={b.minLot} />}
                    <Row k="Density allowance on record" v={<b style={{ fontSize: 17, color: "var(--blue)" }}>{b?.maxUnits != null ? b.maxUnits : "—"}</b>} />
                    {b?.envelope && <Row k="Est. buildable footprint" v={b.envelope.toLocaleString() + " sf"} />}
                    <Row k="ADU allowance" v={<span style={{ color: "var(--taupe)", fontWeight: 400 }}>state law generally permits — confirm locally</span>} />
                    {b?.cite && <div className="note">Density and setbacks summarised from {b.cite}. Confirm overlays at permitting.</div>}
                  </>)}
              </section>

              <section className="sec">
                <h3>Entitlement intelligence <em>· researched</em></h3>
                {znBusy && !zoning ? <div className="quiet">Researching the governing code, general plan and state overrides…</div>
                  : zoning ? (<>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                      <b style={{ fontSize: 14 }}>{zoning.zone || "Zone not confirmed"}</b>
                      {zoning.jurisdiction && <span style={{ fontSize: 12.5, color: "var(--blue)" }}>{zoning.jurisdiction}</span>}
                      {zoning.confidence && <span className={`pill ${zoning.confidence === "high" ? "green" : zoning.confidence === "medium" ? "amber" : "gray"}`} style={{ marginLeft: "auto" }}>{zoning.confidence} confidence</span>}
                    </div>
                    {zoning.summary && <p style={{ margin: "9px 0 0", fontSize: 13, lineHeight: 1.6 }}>{zoning.summary}</p>}
                    {Array.isArray(zoning.permittedUses) && zoning.permittedUses.length > 0 && (
                      <div className="chips">{zoning.permittedUses.map((x: string, i: number) => <span key={i}>{x}</span>)}</div>
                    )}
                    {Array.isArray(zoning.standards) && zoning.standards.filter((s: any) => s?.value).length > 0 && (
                      <div style={{ marginTop: 10 }}>{zoning.standards.filter((s: any) => s?.value).map((s: any, i: number) => <Row key={i} k={s.label} v={String(s.value)} />)}</div>
                    )}
                    {zoning.adu && <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.55 }}><b style={{ color: "var(--blue)" }}>ADUs. </b>{zoning.adu}</p>}
                    {zoning.opportunities && <p style={{ margin: "7px 0 0", fontSize: 12.5, lineHeight: 1.55 }}><b style={{ color: "var(--blue)" }}>Upside. </b>{zoning.opportunities}</p>}
                    {zoning.process && <p style={{ margin: "7px 0 0", fontSize: 12.5, lineHeight: 1.55 }}><b style={{ color: "var(--blue)" }}>Process. </b>{zoning.process}</p>}
                    {Array.isArray(zoning.flags) && zoning.flags.length > 0 && (
                      <div className="flagbox">
                        <b>Could stop or delay a deal</b>
                        {zoning.flags.map((f: string, i: number) => <div key={i}>• {f}</div>)}
                      </div>
                    )}
                    {znSources.length > 0 && <div className="src">Sources: {znSources.join(" · ")}</div>}
                  </>)
                  : <div className="quiet">The governing zone couldn&apos;t be pinned from public sources for this parcel. Treat zoning as unconfirmed and verify the district and standards with the planning department.</div>}
              </section>

              <section className="sec">
                <h3>Hazards &amp; constraints</h3>
                {(["flood", "fire", "williamson", "terrain"] as const).map(key => {
                  const r = rk?.[key];
                  const labels: Record<string, string> = { flood: "Flood zone (FEMA)", fire: "Fire hazard", williamson: "Williamson Act", terrain: "Terrain" };
                  return <Row key={key} k={labels[key]} v={repBusy && !r ? "…" : r ? <span className={`pill ${r.level}`}>{r.text}</span> : "—"} />;
                })}
                {wc && (<>
                  {wc.no && <Row k="Contract number" v={String(wc.no)} />}
                  {wc.eff && <Row k="Contract effective" v={monthYear(wc.eff)} />}
                  {wc.exp && <Row k="Contract expires" v={monthYear(wc.exp)} />}
                  <Row k="Non-renewal filed" v={wc.nonRenewal ? <span className="pill amber">Yes</span> : "No"} />
                </>)}
              </section>

              {sale?.any && (
                <section className="sec">
                  <h3>Ownership &amp; sale history</h3>
                  {sale.price && sale.date ? <Row k="Last recorded sale" v={`${money(sale.price)} — ${monthYear(sale.date)}`} />
                    : sale.date ? <Row k="Last recorded sale" v={monthYear(sale.date)} /> : null}
                  {sale.pPrice && sale.pDate && <Row k="Prior sale" v={`${money(sale.pPrice)} — ${monthYear(sale.pDate)}`} />}
                  {sale.annual != null && sale.held != null && (
                    <Row k="Change between sales" v={<span style={{ color: sale.annual > 0.5 ? "var(--good)" : sale.annual < -0.5 ? "var(--bad)" : "var(--taupe)" }}>
                      {sale.annual >= 0 ? "+" : ""}{sale.annual.toFixed(1)}% a year over {sale.held.toFixed(0)} years
                    </span>} />
                  )}
                  {sale.sinceLast != null && <Row k="Held since last sale" v={`${sale.sinceLast.toFixed(0)} years`} />}
                  {sale.price && sel.acreage > 0 && <Row k="Last sale per acre" v={money(sale.price / sel.acreage)} />}
                  <div className="note">Recorded sale prices include non-arm&apos;s-length transfers. Check the transfer type before treating one as a comp.</div>
                </section>
              )}

              <section className="sec">
                <h3>Value &amp; tax basis</h3>
                {useCode && <Row k="Land use (county code)" v={String(useCode)} />}
                <Row k="Assessed value" v={val || <span style={{ color: "var(--mute)", fontWeight: 400 }}>{exemptish(sel.attrs) ? "tax-exempt — not assessed" : "not published by this county"}</span>} />
                <Row k="Assessed land value" v={land || <span style={{ color: "var(--mute)", fontWeight: 400 }}>{exemptish(sel.attrs) ? "tax-exempt — not assessed" : "not published by this county"}</span>} />
                {val && sel.acreage > 0 && <Row k="Assessed per acre" v={money((assessedTotal(sel.attrs) || 0) / sel.acreage)} />}
                {tax && <Row k="Assessment status" v={<span className={`pill ${tax.prop8 ? "amber" : "gray"}`}>{tax.text}</span>} />}
                <div className="note">
                  {tax?.prop8
                    ? "A reduced assessment is temporary — the county restores full value as conditions recover, and a sale resets the basis to the purchase price."
                    : "Assessed values track the Prop 13 basis, not the market. A sale resets the basis to the purchase price, so model the buyer's tax bill from the offer, not from this figure."}
                </div>
              </section>

              <section className="sec">
                <h3>Structure &amp; assessor record</h3>
                {(() => {
                  const yr = pickVal(sel.attrs, ["YearBuilt1", "BuildingPrimaryYearBuilt", "YearBuilt", "EffectiveYear1", "yearbuilt"]);
                  const sq = pickVal(sel.attrs, ["SQFTmain1", "BuildingPrimarySize", "SQFTmain", "BuildingArea", "sqft", "LivingArea"]);
                  const bd = pickVal(sel.attrs, ["Bedrooms1", "BuildingPrimaryBedRooms", "Bedrooms", "BEDROOMS", "NBR_BEDROOMS"]);
                  const ba = pickVal(sel.attrs, ["Bathrooms1", "BuildingPrimaryBaths", "Bathrooms", "BATHROOMS"]);
                  const un = pickVal(sel.attrs, ["Units1", "BuildingPrimaryUnitCount", "Units", "NBR_UNITS"]);
                  const ud = pickVal(sel.attrs, ["UseDescription", "UseCodeDescription", "UseType", "AssessDescription", "usedesc"]);
                  const lg = pickVal(sel.attrs, ["LegalDescription", "LegalDescLine1", "AsmtDescription"]);
                  const pool = numOf(pickVal(sel.attrs, ["HasPool"]));
                  const imp = money(pickVal(sel.attrs, ["Roll_ImpValue", "Value601Structure", "ImpValue", "improvval", "ImprovementValue"]));
                  if (!(yr || sq || bd || ba || un || ud || lg || imp)) return <div className="quiet">This county&apos;s parcel layer doesn&apos;t publish structure detail. The assessor may still hold it — verify with the county.</div>;
                  return (<>
                    {ud && <Row k="Use on record" v={String(ud)} />}
                    {yr && <Row k="Year built" v={String(yr)} />}
                    {sq && Number(sq) > 0 && <Row k="Building area" v={Number(sq).toLocaleString() + " sf"} />}
                    {(bd || ba) && <Row k="Bedrooms / bathrooms" v={`${bd ?? "—"} / ${ba ?? "—"}`} />}
                    {un && <Row k="Units on record" v={String(un)} />}
                    {pool === 1 && <Row k="Pool" v="On record" />}
                    {imp && <Row k="Improvement value" v={imp} />}
                    {lg && <Row k="Legal description" v={<span style={{ fontWeight: 400, color: "var(--taupe)", fontSize: 12 }}>{String(lg)}</span>} />}
                  </>);
                })()}
              </section>

              <section className="sec">
                <h3>Area activity</h3>
                {!actEnabled ? <div className="quiet">Area development intelligence turns on with an Anthropic API key. It searches for nearby data centre, industrial and commercial projects and reads what they mean for land value here.</div>
                  : actBusy && !activity ? <div className="quiet">Scanning the area for major developments…</div>
                  : activity ? <><p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{activity}</p>{actSources.length > 0 && <div className="src">Sources: {actSources.join(" · ")}</div>}</>
                  : <div className="quiet">No notable nearby development activity found.</div>}
              </section>

              <section className="sec">
                <h3>Neighborhood</h3>
                {ctxBusy && !ctx ? <div className="quiet">Pulling census and city records…</div>
                  : ctx ? (<>
                    {ctx.communityPlan && <Row k="Community plan area" v={ctx.communityPlan} />}
                    {ctx.tract && <Row k="Census tract" v={ctx.tract} />}
                    {Array.isArray(ctx.demographics) && ctx.demographics.map((d: any, i: number) => <Row key={i} k={d.label} v={d.value} />)}
                    {ctx.acsNeedsKey && <div className="note">Income, home value, rent and ownership for this tract need a free Census API key. Set <b>CENSUS_API_KEY</b> in the project environment to switch this on.</div>}
                    {(["schools", "colleges", "hospitals"] as const).map(k => {
                      const list = ctx[k]; if (!Array.isArray(list) || !list.length) return null;
                      const title = k === "schools" ? "Nearest public schools" : k === "colleges" ? "Colleges nearby" : "Nearest hospitals";
                      return (<div key={k} style={{ marginTop: 13 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--taupe)", marginBottom: 4 }}>{title}</div>
                        {list.map((x: any, i: number) => (
                          <div className="row" key={i}>
                            <span style={{ color: "var(--ink)" }}>{x.name}{x.sub && <span style={{ color: "var(--mute)" }}> · {x.sub}</span>}</span>
                            <span style={{ fontWeight: 400, color: "var(--taupe)", whiteSpace: "nowrap" }}>{x.distance}</span>
                          </div>
                        ))}
                      </div>);
                    })}
                    {ctx.sources?.length > 0 && <div className="src">Sources: {ctx.sources.join(" · ")}</div>}
                  </>)
                  : <div className="quiet">Neighborhood data unavailable for this location.</div>}
              </section>

              <div className="legal">
                <b>Disclaimer.</b> This report is provided for informational purposes only and does not constitute legal, financial, investment, tax, or land-use advice, an appraisal, or a recommendation to buy or sell any property. Data is drawn from public county, state, and federal sources that may be incomplete, outdated, or contain errors, and portions of the analysis are AI-generated and may be inaccurate. Zoning, overlays, hazard designations, and development standards change and must be independently verified with the applicable city or county planning department before any decision. K2 Investment and its affiliates make no warranty of accuracy or completeness and accept no liability for actions taken in reliance on this report. Consult licensed professionals (attorney, engineer, surveyor, broker) before purchasing or developing land.
              </div>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
