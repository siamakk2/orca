import { NextRequest, NextResponse } from "next/server";
import area from "@turf/area";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Src = { url: string; apn: string[]; addr: string[]; num?: string[] };
type County = { slug: string; label: string; bbox: [number,number,number,number]; sources: Src[] };

const COUNTIES: County[] = [
  { slug:"los_angeles", label:"Los Angeles", bbox:[-118.95,33.70,-117.64,34.82], sources:[
    { url:"https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0/query", apn:["AIN","APN"], addr:["SitusFullAddress","SitusAddress"] },
  ]},
  { slug:"napa", label:"Napa", bbox:[-122.65,38.15,-122.06,38.87], sources:[
    { url:"https://gis.napacounty.gov/arcgis/rest/services/Hosted/Parcels_Public/FeatureServer/0/query", apn:["asmtwithdash","asmt"], addr:["streetaddr"] },
  ]},
  { slug:"orange", label:"Orange", bbox:[-118.13,33.34,-117.40,33.95], sources:[
    { url:"https://www.ocgis.com/arcpub/rest/services/Map_Layers/Parcels/MapServer/0/query", apn:["ASSESSMENT_NO"], addr:["SITE_ADDRESS"] },
  ]},
  { slug:"san_diego", label:"San Diego", bbox:[-117.61,32.52,-116.08,33.51], sources:[
    { url:"https://webmaps.sandiego.gov/arcgis/rest/services/GeocoderMerged/MapServer/1/query", apn:["APN","APN_8"], addr:["SITUS_STREET"], num:["SITUS_ADDRESS"] },
  ]},
  { slug:"san_bernardino", label:"San Bernardino", bbox:[-117.81,33.86,-114.13,35.81], sources:[
    { url:"https://services.arcgis.com/aA3snZwJfFkVyDuP/arcgis/rest/services/Parcels_for_San_Bernardino_County/FeatureServer/0/query", apn:["ParcelNumber"], addr:["SitusAddress","Address"] },
  ]},
  { slug:"sacramento", label:"Sacramento", bbox:[-121.87,38.01,-121.02,38.74], sources:[
    { url:"https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/Parcels/FeatureServer/0/query", apn:["APN"], addr:["STREET_NAM"], num:["STREET_NBR"] },
  ]},
  { slug:"santa_clara", label:"Santa Clara", bbox:[-122.21,36.88,-121.20,37.49], sources:[
    { url:"https://services8.arcgis.com/fpjs8A5Vtkshblnd/arcgis/rest/services/Santa_Clara_County_Parcels/FeatureServer/0/query", apn:["apn"], addr:["situs_stre"], num:["situs_hous"] },
  ]},
  { slug:"alameda", label:"Alameda", bbox:[-122.37,37.45,-121.46,37.91], sources:[
    { url:"https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Parcels/FeatureServer/0/query", apn:["APN"], addr:["SitusAddress","SitusStreetName"] },
  ]},
  { slug:"contra_costa", label:"Contra Costa", bbox:[-122.44,37.71,-121.53,38.10], sources:[
    { url:"https://gis.cccounty.us/arcgis/rest/services/CCMAP/Assessment_Parcels_ArcPro/MapServer/0/query", apn:["APN"], addr:["N_STR_NM"], num:["N_STR_NBR"] },
  ]},
  { slug:"ventura", label:"Ventura", bbox:[-119.65,33.98,-118.63,34.90], sources:[
    { url:"https://maps.ventura.org/arcgis/rest/services/SDs/Parcels/MapServer/0/query", apn:["APN","APN10"], addr:["SITUS","SITUS_STRE"] },
  ]},
  { slug:"sonoma", label:"Sonoma", bbox:[-123.54,38.10,-122.34,38.86], sources:[
    { url:"https://socogis.sonomacounty.ca.gov/map/rest/services/OWTSPublic/Cities_GIS_Parcel_Base/FeatureServer/0/query", apn:["APN"], addr:["SitusFormatted1","SitusStreetName"] },
  ]},
];

const bySlug = (s:string|null) => COUNTIES.find(c=>c.slug===s) || null;
const route = (lon:number,lat:number) => COUNTIES.find(c=>{const[w,s,e,n]=c.bbox;return lon>=w&&lon<=e&&lat>=s&&lat<=n})||null;
const routeAll = (lon:number,lat:number) => COUNTIES.filter(c=>{const[w,s,e,n]=c.bbox;return lon>=w&&lon<=e&&lat>=s&&lat<=n});

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
  const a=f.attributes||{};
  const st=first(a,src.addr); const num=src.num?first(a,src.num):null;
  const address = (num&&st)?`${num} ${st}` : (st||num||"");
  const zoning=first(a,["Zoning","ZONING","ZONE","zoning","ZONE_CODE","zone_code","zone","ZONE_"]);
  return {apn:first(a,src.apn)||"—",address,acreage:acres(g),label,geometry:g,attrs:a,zoning:zoning||null};
}

const SUF=new Set(["RD","ROAD","ST","STREET","AVE","AVENUE","BLVD","DR","DRIVE","LN","LANE","WAY","CT","COURT","PL","PLACE","CIR","CIRCLE","TER","HWY","PKWY","TRL","N","S","E","W"]);
const isApn = (s:string)=>/^[0-9][0-9\- ]{4,}[0-9]$/.test(s.trim());
function apnWhere(src:Src,s:string){const raw=s.trim().toUpperCase().replace(/'/g,"''"),dig=raw.replace(/[^0-9]/g,""),c:string[]=[];for(const f of src.apn){c.push(`${f}='${raw}'`);if(dig&&dig!==raw)c.push(`${f}='${dig}'`)}return c.join(" OR ")}
function addrWhere(src:Src,s:string){
  const up=s.trim().toUpperCase().replace(/'/g,"''"),t=up.split(/\s+/).filter(Boolean);
  if(!t.length)return null;
  let num=""; if(/^\d+[A-Z]?$/.test(t[0]))num=t.shift() as string;
  const st=t.filter(x=>!SUF.has(x)&&x!=="CA"&&x!=="CALIFORNIA");
  const key=st[0]||""; // most distinctive street word
  if(!key&&!num)return null;
  if(src.num&&src.num.length){
    const parts:string[]=[];
    if(num)parts.push("("+src.num.map(f=>`${f}='${num}'`).join(" OR ")+")");
    if(key)parts.push("("+src.addr.map(f=>`UPPER(${f}) LIKE '%${key}%'`).join(" OR ")+")");
    return parts.length?parts.join(" AND "):null;
  }
  const pat=(num?num+"%":"%")+(key?key+"%":"");
  return src.addr.map(f=>`UPPER(${f}) LIKE '${pat}'`).join(" OR ");
}

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

    // ---- APN search: query the assessor number directly across counties ----
    if(apn){
      const cands = bySlug(sp.get("county")) ? [bySlug(sp.get("county"))!] : COUNTIES;
      for(const c of cands){ for(const src of c.sources){ try{
        const feats=await q(src,{where:apnWhere(src,s),resultRecordCount:"12"});
        const matches=feats.map((f:any)=>rec(f,src,c.label)).filter(Boolean).slice(0,12);
        if(matches.length)return NextResponse.json({status:"ok",county:c.slug,label:c.label,matches});
      }catch{} } }
    }

    // ---- Address search: geocode, then read the exact parcel under that point ----
    let geo:{lat:number;lon:number}|null=null;
    if(!apn){
      geo=await geocode(/CA\b|California|County/i.test(s)?s:`${s}, CA`);
      const near = geo ? routeAll(geo.lon,geo.lat) : [];

      // 1) exact parcel containing the geocoded point (schema-independent, most reliable)
      if(geo){
        const pt={x:geo.lon,y:geo.lat,spatialReference:{wkid:4326}};
        for(const c of near){ for(const src of c.sources){ try{
          const feats=await q(src,{geometry:JSON.stringify(pt),geometryType:"esriGeometryPoint",inSR:"4326",spatialRel:"esriSpatialRelIntersects",resultRecordCount:"5"});
          const m=feats.map((f:any)=>rec(f,src,c.label)).filter(Boolean);
          if(m.length)return NextResponse.json({status:"ok",county:c.slug,label:c.label,matches:m.slice(0,12)});
        }catch{} } }
      }

      // 2) text match on the street address (handles APN-less lookups the geocoder missed)
      for(const c of near){ for(const src of c.sources){ try{
        const where=addrWhere(src,s); if(!where)continue;
        const feats=await q(src,{where,resultRecordCount:"12",orderByFields:src.addr[0]});
        const matches=feats.map((f:any)=>rec(f,src,c.label)).filter(Boolean).slice(0,12);
        if(matches.length)return NextResponse.json({status:"ok",county:c.slug,label:c.label,matches});
      }catch{} } }

      // 3) nearby parcels (vacant land with no address on file)
      if(geo){
        const d=0.0012, env={xmin:geo.lon-d,ymin:geo.lat-d,xmax:geo.lon+d,ymax:geo.lat+d,spatialReference:{wkid:4326}};
        for(const c of near){ for(const src of c.sources){ try{
          const feats=await q(src,{geometry:JSON.stringify(env),geometryType:"esriGeometryEnvelope",inSR:"4326",spatialRel:"esriSpatialRelIntersects",resultRecordCount:"25"});
          const withD=(feats.map((f:any)=>{const r=rec(f,src,c.label);if(!r)return null;let cx=0,cy=0,nn=0;const gg:any=r.geometry;(gg.type==="Polygon"?[gg.coordinates]:gg.coordinates).forEach((pl:any)=>pl[0].forEach((pc:any)=>{cx+=pc[0];cy+=pc[1];nn++}));cx/=nn;cy/=nn;return {r,dist:(cx-geo!.lon)**2+(cy-geo!.lat)**2}}).filter(Boolean) as {r:any,dist:number}[]);
          withD.sort((a,b)=>a.dist-b.dist);
          const m=withD.map(x=>x.r);
          if(m.length)return NextResponse.json({status:"ok",match:"nearby",county:c.slug,label:c.label,matches:m.slice(0,12)});
        }catch{} } }
      }
    }

    // ---- Regrid statewide fallback (fills the other 47 counties once a paid token is set) ----
    if(REGRID){
      try{
        const query=apn?s:(/CA\b|California/i.test(s)?s:`${s}, CA`);
        const m=await regridSearch(query);
        if(m.length)return NextResponse.json({status:"ok",provider:"regrid",label:m[0]!.label,matches:m.slice(0,12)});
      }catch{}
    }

    if(geo && !routeAll(geo.lon,geo.lat).length) return NextResponse.json({status:"expanding",message:`That address is in California but outside the counties we cover so far — we're expanding statewide.`});
    return NextResponse.json({status:"not_found",message:`No parcel found for "${s}". Try the full street address (street + city) or the APN.`});
  }
  const lat=parseFloat(sp.get("lat")||""),lon=parseFloat(sp.get("lon")||"");
  if(Number.isNaN(lat)||Number.isNaN(lon))return NextResponse.json({status:"error",message:"q or lat/lon required"},{status:400});
  for(const county of routeAll(lon,lat)){
    for(const src of county.sources){try{
      const feats=await q(src,{geometry:JSON.stringify({x:lon,y:lat,spatialReference:{wkid:4326}}),geometryType:"esriGeometryPoint",inSR:"4326",spatialRel:"esriSpatialRelIntersects"});
      const m=feats.map((f:any)=>rec(f,src,county.label)).filter(Boolean);
      if(m.length)return NextResponse.json({status:"ok",county:county.slug,label:county.label,matches:m});
    }catch{}}
  }
  if(REGRID){ try{const m=await regridPoint(lon,lat);if(m.length)return NextResponse.json({status:"ok",provider:"regrid",label:m[0]!.label,matches:m})}catch{} }
  return NextResponse.json({status:"not_found",message:"No parcel at that spot."});
}
