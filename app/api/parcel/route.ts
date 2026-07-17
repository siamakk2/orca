import { NextRequest, NextResponse } from "next/server";
import area from "@turf/area";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Src = { url: string; apn: string[]; addr: string[] };
type County = { slug: string; label: string; bbox: [number,number,number,number]; sources: Src[] };

const COUNTIES: County[] = [
  { slug:"los_angeles", label:"Los Angeles", bbox:[-118.95,33.7,-117.64,34.82], sources:[
    { url:"https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0/query", apn:["AIN","APN"], addr:["SitusFullAddress","SitusAddress"] },
  ]},
  { slug:"napa", label:"Napa", bbox:[-122.65,38.15,-122.06,38.87], sources:[
    { url:"https://gis.napacounty.gov/arcgis/rest/services/Hosted/Parcels_Public/FeatureServer/0/query", apn:["asmtwithdash","asmt"], addr:["streetaddr"] },
  ]},
];

const bySlug = (s:string|null) => COUNTIES.find(c=>c.slug===s) || null;
const route = (lon:number,lat:number) => COUNTIES.find(c=>{const[w,s,e,n]=c.bbox;return lon>=w&&lon<=e&&lat>=s&&lat<=n})||null;

function cw(r:number[][]){let s=0;for(let i=0;i<r.length;i++){const[a,b]=r[i],[c,d]=r[(i+1)%r.length];s+=(c-a)*(d+b)}return s>0}
function rings2geo(rings:number[][][]){const o=rings.filter(cw),h=rings.filter(r=>!cw(r)),base=o.length?o:rings,p=base.map(x=>[x]);for(const x of h)p[0]?.push(x);return p.length===1?{type:"Polygon",coordinates:p[0]}:{type:"MultiPolygon",coordinates:p}}
function first(a:Record<string,unknown>,n:string[]){for(const k of n){const v=a?.[k];if(v!=null&&String(v).trim()!=="")return String(v).trim()}return null}
function acres(g:unknown){return Math.round(area(g as GeoJSON.Geometry)/4046.8564224*1000)/1000}

async function q(src:Src,extra:Record<string,string>){
  const p=new URLSearchParams({outFields:"*",returnGeometry:"true",outSR:"4326",f:"json",...extra});
  const r=await fetch(`${src.url}?${p}`,{cache:"no-store"});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  const d=await r.json();
  if(d.error)throw new Error(d.error?.message||"GIS error");
  return d.features||[];
}
function rec(f:any,src:Src,label:string){
  if(!f?.geometry?.rings)return null;
  const g=rings2geo(f.geometry.rings);
  return {apn:first(f.attributes||{},src.apn)||"—",address:first(f.attributes||{},src.addr)||"",acreage:acres(g),label,geometry:g};
}

const SUF=new Set(["RD","ROAD","ST","STREET","AVE","AVENUE","BLVD","DR","DRIVE","LN","LANE","WAY","CT","COURT","PL","PLACE","CIR","CIRCLE","TER","HWY","PKWY","TRL","N","S","E","W"]);
const isApn = (s:string)=>/^[0-9][0-9\- ]{4,}[0-9]$/.test(s.trim());
function apnWhere(src:Src,s:string){const raw=s.trim().toUpperCase().replace(/'/g,"''"),dig=raw.replace(/[^0-9]/g,""),c:string[]=[];for(const f of src.apn){c.push(`${f}='${raw}'`);if(dig&&dig!==raw)c.push(`${f}='${dig}'`)}return c.join(" OR ")}
function addrWhere(src:Src,s:string){const up=s.trim().toUpperCase().replace(/'/g,"''"),t=up.split(/\s+/).filter(Boolean);if(!t.length)return null;let num="";if(/^\d+[A-Z]?$/.test(t[0]))num=t.shift() as string;const st=t.filter(x=>!SUF.has(x));if(!st.length&&!num)return null;const pat=(num?num+"%":"%")+st.join("%")+"%";return src.addr.map(f=>`UPPER(${f}) LIKE '${pat}'`).join(" OR ")}

async function geocode(s:string){
  try{const u="https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?"+new URLSearchParams({address:s,benchmark:"Public_AR_Current",format:"json"});const r=await fetch(u,{cache:"no-store",signal:AbortSignal.timeout(15000)});if(r.ok){const d=await r.json(),m=d?.result?.addressMatches?.[0];if(m?.coordinates)return{lat:m.coordinates.y,lon:m.coordinates.x}}}catch{}
  return null;
}

export async function GET(req:NextRequest){
  const sp=req.nextUrl.searchParams, s=(sp.get("q")||"").trim();
  if(s){
    const county=bySlug(sp.get("county"))||COUNTIES[0], apn=isApn(s);
    // gather ALL matching records (up to 25)
    for(const src of county.sources){
      try{
        const where=apn?apnWhere(src,s):addrWhere(src,s);
        if(!where)continue;
        const feats=await q(src,{where,resultRecordCount:"25",orderByFields:src.addr[0]});
        const matches=feats.map((f:any)=>rec(f,src,county.label)).filter(Boolean);
        if(matches.length)return NextResponse.json({status:"ok",county:county.slug,label:county.label,matches});
      }catch{}
    }
    // fallback: geocode -> point
    const g=await geocode(/CA\b|California|County/i.test(s)?s:`${s}, ${county.label} County, CA`);
    if(g){const gc=route(g.lon,g.lat)||county;for(const src of gc.sources){try{const feats=await q(src,{geometry:JSON.stringify({x:g.lon,y:g.lat,spatialReference:{wkid:4326}}),geometryType:"esriGeometryPoint",inSR:"4326",spatialRel:"esriSpatialRelIntersects"});const m=feats.map((f:any)=>rec(f,src,gc.label)).filter(Boolean);if(m.length)return NextResponse.json({status:"ok",match:"approximate",county:gc.slug,label:gc.label,matches:m})}catch{}}}
    return NextResponse.json({status:"not_found",message:`No parcel record for "${s}". Try just the street name, an APN, or tap the map.`});
  }
  const lat=parseFloat(sp.get("lat")||""),lon=parseFloat(sp.get("lon")||"");
  if(Number.isNaN(lat)||Number.isNaN(lon))return NextResponse.json({status:"error",message:"q or lat/lon required"},{status:400});
  const county=route(lon,lat);
  if(!county)return NextResponse.json({status:"out_of_area",message:"Outside Los Angeles and Napa."});
  for(const src of county.sources){try{const feats=await q(src,{geometry:JSON.stringify({x:lon,y:lat,spatialReference:{wkid:4326}}),geometryType:"esriGeometryPoint",inSR:"4326",spatialRel:"esriSpatialRelIntersects"});const m=feats.map((f:any)=>rec(f,src,county.label)).filter(Boolean);if(m.length)return NextResponse.json({status:"ok",county:county.slug,label:county.label,matches:m})}catch{}}
  return NextResponse.json({status:"not_found",message:"No parcel at that spot."});
}
