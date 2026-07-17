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
  return {apn:first(f.attributes||{},src.apn)||"—",address:first(f.attributes||{},src.addr)||"",acreage:acres(g),label,geometry:g,attrs:f.attributes||{}};
}

const SUF=new Set(["RD","ROAD","ST","STREET","AVE","AVENUE","BLVD","DR","DRIVE","LN","LANE","WAY","CT","COURT","PL","PLACE","CIR","CIRCLE","TER","HWY","PKWY","TRL","N","S","E","W"]);
const isApn = (s:string)=>/^[0-9][0-9\- ]{4,}[0-9]$/.test(s.trim());
function apnWhere(src:Src,s:string){const raw=s.trim().toUpperCase().replace(/'/g,"''"),dig=raw.replace(/[^0-9]/g,""),c:string[]=[];for(const f of src.apn){c.push(`${f}='${raw}'`);if(dig&&dig!==raw)c.push(`${f}='${dig}'`)}return c.join(" OR ")}
function addrWhere(src:Src,s:string){const up=s.trim().toUpperCase().replace(/'/g,"''"),t=up.split(/\s+/).filter(Boolean);if(!t.length)return null;let num="";if(/^\d+[A-Z]?$/.test(t[0]))num=t.shift() as string;const st=t.filter(x=>!SUF.has(x));if(!st.length)return null;const pat=(num?num+"%":"%")+st.join("%")+"%";return src.addr.map(f=>`UPPER(${f}) LIKE '${pat}'`).join(" OR ")}

async function geocode(s:string){
  try{const u="https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?"+new URLSearchParams({address:s,benchmark:"Public_AR_Current",format:"json"});const r=await fetch(u,{cache:"no-store",signal:AbortSignal.timeout(15000)});if(r.ok){const d=await r.json(),m=d?.result?.addressMatches?.[0];if(m?.coordinates)return{lat:m.coordinates.y,lon:m.coordinates.x}}}catch{}
  return null;
}

const REGRID = process.env.REGRID_TOKEN;
function titleCase(s:string){return String(s).replace(/\w\S*/g,t=>t[0].toUpperCase()+t.slice(1).toLowerCase())}
function regridRec(f:any){
  const p=f?.properties?.fields||f?.properties||{}; const geo=f?.geometry;
  if(!geo||geo.type!=="Polygon"&&geo.type!=="MultiPolygon")return null;
  const apn=p.parcelnumb||p.parcelnumb_no_formatting||"—";
  const address=p.address||p.headline||[p.saddno,p.saddpref,p.saddstr,p.saddsttyp].filter(Boolean).join(" ").trim()||"";
  const county=p.county?titleCase(String(p.county)):"California";
  let acreage=p.ll_gisacre!=null?Number(p.ll_gisacre):(p.gisacre!=null?Number(p.gisacre):NaN);
  if(Number.isNaN(acreage)){try{acreage=acres(geo)}catch{acreage=0}}
  acreage=Math.round(acreage*1000)/1000;
  return {apn,address,acreage,label:county,geometry:geo,attrs:p,
    zoning:p.zoning||null,zoning_description:p.zoning_description||null,usedesc:p.usedesc||null,
    landval:p.landval??null,parval:p.parval??null,improvval:p.improvval??null};
}
async function regridSearch(query:string){
  const u="https://app.regrid.com/api/v1/search.json?"+new URLSearchParams({query,limit:"25",token:REGRID!});
  const r=await fetch(u,{cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error("regrid "+r.status);
  const d=await r.json();
  return (d.results||d.parcels?.features||d.features||[]).map(regridRec).filter(Boolean);
}
async function regridPoint(lon:number,lat:number){
  const u="https://app.regrid.com/api/v2/parcels/point?"+new URLSearchParams({lat:String(lat),lon:String(lon),radius:"40",limit:"8",token:REGRID!});
  const r=await fetch(u,{cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error("regrid "+r.status);
  const d=await r.json();
  return (d.parcels?.features||d.features||d.results||[]).map(regridRec).filter(Boolean);
}

export async function GET(req:NextRequest){
  const sp=req.nextUrl.searchParams, s=(sp.get("q")||"").trim();
  if(s){
    const apn=isApn(s);
    if(sp.get("debug")==="1"){
      const out:any={ q:s, isApn:apn, regridConfigured:!!REGRID };
      if(REGRID){
        try{
          const query=apn?s:(/CA\b|California/i.test(s)?s:`${s}, CA`);
          const u="https://app.regrid.com/api/v1/search.json?"+new URLSearchParams({query,limit:"3",token:REGRID});
          const r=await fetch(u,{cache:"no-store",signal:AbortSignal.timeout(15000)});
          out.regrid={httpStatus:r.status};
          const txt=await r.text();
          try{ const d=JSON.parse(txt); const arr=(d.results||d.parcels?.features||d.features||[]); out.regrid.resultCount=arr.length; out.regrid.firstKeys=arr[0]?Object.keys(arr[0]):null; out.regrid.firstFieldKeys=arr[0]?.properties?.fields?Object.keys(arr[0].properties.fields).slice(0,20):null; out.regrid.parsedMatches=arr.map(regridRec).filter(Boolean).length; }
          catch{ out.regrid.bodyPreview=txt.slice(0,500); }
        }catch(e:any){ out.regrid={error:String(e?.message||e)}; }
      }
      try{ const g=await geocode(/CA\b|California/i.test(s)?s:`${s}, CA`); out.geocode=g; out.detectedCounty=g?(route(g.lon,g.lat)?.slug||"outside_LA_Napa"):"geocode_failed"; }catch(e:any){ out.geocode={error:String(e?.message||e)}; }
      return NextResponse.json(out);
    }
    // Statewide provider (Regrid) first when configured
    const rgDiag:any={configured:!!REGRID};
    if(REGRID){
      const query=apn?s:(/CA\b|California/i.test(s)?s:`${s}, CA`);
      const u="https://app.regrid.com/api/v1/search.json?"+new URLSearchParams({query,limit:"25",token:REGRID});
      try{
        const r=await fetch(u,{cache:"no-store",signal:AbortSignal.timeout(15000)});
        rgDiag.status=r.status;
        if(r.ok){
          const d=await r.json();
          const arr=(d.results||d.parcels?.features||d.features||[]);
          rgDiag.count=arr.length;
          const m=arr.map(regridRec).filter(Boolean);
          rgDiag.parsed=m.length;
          if(m.length)return NextResponse.json({status:"ok",provider:"regrid",label:m[0]!.label,matches:m.slice(0,12),_diag:rgDiag});
        } else { rgDiag.body=(await r.text()).slice(0,160); }
      }catch(e:any){ rgDiag.error=String(e?.message||e); }
    }
    let county=bySlug(sp.get("county"));
    let geo:{lat:number;lon:number}|null=null;
    if(!county && !apn){ geo=await geocode(/CA\b|California|County/i.test(s)?s:`${s}, CA`); if(geo){ county=route(geo.lon,geo.lat); } }
    const cand = county ? [county] : COUNTIES;
    for(const c of cand){
      for(const src of c.sources){
        try{
          const where=apn?apnWhere(src,s):addrWhere(src,s);
          if(!where)continue;
          const feats=await q(src,{where,resultRecordCount:"12",orderByFields:src.addr[0]});
          const matches=feats.map((f:any)=>rec(f,src,c.label)).filter(Boolean).slice(0,12);
          if(matches.length)return NextResponse.json({status:"ok",county:c.slug,label:c.label,matches,_diag:rgDiag});
        }catch{}
      }
    }
    // 2) geocode → nearby parcels (catches vacant lots with no address on file)
    if(!geo) geo=await geocode(/CA\b|California|County/i.test(s)?s:`${s}, CA`);
    if(geo){
      const gc=route(geo.lon,geo.lat);
      if(!gc) return NextResponse.json({status:"expanding",message:`That address is in California but outside our live counties (Los Angeles & Napa). Full statewide coverage is rolling out.`,_diag:rgDiag});
      const d=0.008, env={xmin:geo.lon-d,ymin:geo.lat-d,xmax:geo.lon+d,ymax:geo.lat+d,spatialReference:{wkid:4326}};
      for(const src of gc.sources){try{
        const feats=await q(src,{geometry:JSON.stringify(env),geometryType:"esriGeometryEnvelope",inSR:"4326",spatialRel:"esriSpatialRelIntersects",resultRecordCount:"25"});
        const withD=(feats.map((f:any)=>{const r=rec(f,src,gc.label);if(!r)return null;let cx=0,cy=0,nn=0;const gg:any=r.geometry;(gg.type==="Polygon"?[gg.coordinates]:gg.coordinates).forEach((pl:any)=>pl[0].forEach((c:any)=>{cx+=c[0];cy+=c[1];nn++}));cx/=nn;cy/=nn;return {r,dist:(cx-geo!.lon)**2+(cy-geo!.lat)**2}}).filter(Boolean) as {r:any,dist:number}[]);
        withD.sort((a,b)=>a.dist-b.dist);
        const m=withD.map(x=>x.r);
        if(m.length)return NextResponse.json({status:"ok",match:"nearby",county:gc.slug,label:gc.label,matches:m.slice(0,12),_diag:rgDiag});
      }catch{}}
    }
    return NextResponse.json({status:"not_found",message:`No parcel found for "${s}". Try the full street address or an APN.`,_diag:rgDiag});
  }
  const lat=parseFloat(sp.get("lat")||""),lon=parseFloat(sp.get("lon")||"");
  if(Number.isNaN(lat)||Number.isNaN(lon))return NextResponse.json({status:"error",message:"q or lat/lon required"},{status:400});
  if(REGRID){
    try{const m=await regridPoint(lon,lat);if(m.length)return NextResponse.json({status:"ok",provider:"regrid",label:m[0]!.label,matches:m})}catch{}
  }
  const county=route(lon,lat);
  if(!county)return NextResponse.json({status:"out_of_area",message:"That point isn't in a county we can read yet."});
  for(const src of county.sources){try{const feats=await q(src,{geometry:JSON.stringify({x:lon,y:lat,spatialReference:{wkid:4326}}),geometryType:"esriGeometryPoint",inSR:"4326",spatialRel:"esriSpatialRelIntersects"});const m=feats.map((f:any)=>rec(f,src,county.label)).filter(Boolean);if(m.length)return NextResponse.json({status:"ok",county:county.slug,label:county.label,matches:m})}catch{}}
  return NextResponse.json({status:"not_found",message:"No parcel at that spot."});
}
