"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Slug = "los_angeles" | "napa";
const VIEWS: Record<Slug,{c:[number,number];z:number;label:string}> = {
  los_angeles:{c:[-118.2437,34.0522],z:11,label:"Los Angeles"},
  napa:{c:[-122.2869,38.2975],z:12,label:"Napa"},
};
const STYLE = {version:8,sources:{carto:{type:"raster",tiles:["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png","https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png","https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png","https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"],tileSize:256,attribution:"© OpenStreetMap © CARTO"}},layers:[{id:"carto",type:"raster",source:"carto"}]} as unknown as maplibregl.StyleSpecification;

type Match = {apn:string;address:string;acreage:number;label:string;geometry:GeoJSON.Geometry};

export default function Home(){
  const mapRef=useRef<maplibregl.Map|null>(null);
  const boxRef=useRef<HTMLDivElement|null>(null);
  const [county,setCounty]=useState<Slug>("napa");
  const [addr,setAddr]=useState("");
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("Search an address or APN, or tap the map.");
  const [matches,setMatches]=useState<Match[]>([]);
  const [sel,setSel]=useState<Match|null>(null);
  const [ready,setReady]=useState(false);

  useEffect(()=>{
    if(mapRef.current||!boxRef.current)return;
    const m=new maplibregl.Map({container:boxRef.current,style:STYLE,center:VIEWS.napa.c,zoom:VIEWS.napa.z});
    mapRef.current=m;
    m.addControl(new maplibregl.NavigationControl(),"top-right");
    m.on("load",()=>{
      m.resize();setReady(true);
      m.addSource("p",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
      m.addLayer({id:"pf",type:"fill",source:"p",paint:{"fill-color":"#06b6d4","fill-opacity":0.28}});
      m.addLayer({id:"pl",type:"line",source:"p",paint:{"line-color":"#0e7490","line-width":2.5}});
    });
    m.on("error",e=>console.warn("map",e?.error?.message||e));
    m.on("click",e=>{void lookupPoint(e.lngLat.lat,e.lngLat.lng)});
    return ()=>{m.remove();mapRef.current=null};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  function draw(g:GeoJSON.Geometry|null){
    const m=mapRef.current, src=m?.getSource("p") as maplibregl.GeoJSONSource|undefined;
    if(!src||!m)return;
    if(!g){src.setData({type:"FeatureCollection",features:[]});return}
    src.setData({type:"FeatureCollection",features:[{type:"Feature",properties:{},geometry:g}]});
    const b=new maplibregl.LngLatBounds(), gg=g as GeoJSON.Polygon|GeoJSON.MultiPolygon;
    const rings=gg.type==="Polygon"?gg.coordinates:gg.coordinates.flat();
    rings.flat().forEach(c=>b.extend(c as [number,number]));
    if(!b.isEmpty())m.fitBounds(b,{padding:80,maxZoom:18});
  }
  function choose(mt:Match){setSel(mt);setMatches([]);draw(mt.geometry);setMsg(`${mt.label} County · ${mt.address||mt.apn}`)}

  async function run(url:string,label:string){
    setBusy(true);setSel(null);setMatches([]);setMsg(label);
    try{
      const r=await fetch(url);const d=await r.json();
      if(d.status==="ok"&&d.matches?.length){
        const near=d.match==="nearby"||d.match==="approximate";
        if(d.matches.length===1&&!near){choose(d.matches[0])}
        else{setMatches(d.matches);draw(null);setMsg(near?"No address on file for that number — here are the parcels at that spot, nearest first. Pick yours:":`${d.matches.length} parcels match — pick yours below.`)}
      } else {draw(null);setMsg(d.message||"No parcel found.")}
    }catch{setMsg("Search failed — try again.")}
    finally{setBusy(false)}
  }
  const lookupPoint=(lat:number,lon:number)=>run(`/api/parcel?lat=${lat}&lon=${lon}`,"Fetching parcel…");
  const search=()=>{const q=addr.trim();if(q)run(`/api/parcel?q=${encodeURIComponent(q)}&county=${county}`,"Searching records…")};
  function jump(c:Slug){setCounty(c);mapRef.current?.flyTo({center:VIEWS[c].c,zoom:VIEWS[c].z})}

  return (
    <div style={{position:"relative",height:"100vh",width:"100vw",overflow:"hidden",fontFamily:"system-ui,sans-serif"}}>
      <div ref={boxRef} style={{position:"absolute",inset:0,background:"#eef2f5"}}/>
      {/* top bar */}
      <div style={{position:"absolute",top:0,left:0,right:0,zIndex:10,display:"flex",flexWrap:"wrap",gap:8,padding:12,alignItems:"flex-start",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,background:"#0f172a",borderRadius:12,padding:"10px 16px",boxShadow:"0 4px 14px rgba(0,0,0,.2)"}}>
          <span style={{color:"#fff",fontWeight:700,fontSize:18}}>Orca</span>
          <div style={{display:"flex",borderRadius:8,overflow:"hidden",border:"1px solid #334155"}}>
            {(["los_angeles","napa"] as const).map(c=>(
              <button key={c} onClick={()=>jump(c)} style={{padding:"5px 12px",fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:county===c?"#06b6d4":"transparent",color:county===c?"#fff":"#cbd5e1"}}>{VIEWS[c].label}</button>
            ))}
          </div>
        </div>
        <div style={{display:"flex",gap:8,background:"#fff",borderRadius:12,padding:8,boxShadow:"0 4px 14px rgba(0,0,0,.15)",flex:"1 1 320px",maxWidth:460}}>
          <input value={addr} onChange={e=>setAddr(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")search()}} placeholder={`Address or APN in ${VIEWS[county].label}…`} style={{flex:1,minWidth:0,border:"none",outline:"none",fontSize:14,padding:"8px 10px",color:"#0f172a"}}/>
          <button onClick={search} disabled={busy} style={{border:"none",borderRadius:8,background:"#06b6d4",color:"#fff",fontWeight:600,fontSize:14,padding:"8px 16px",cursor:"pointer",opacity:busy?.5:1}}>{busy?"…":"Search"}</button>
        </div>
      </div>
      {/* status */}
      <div style={{position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",zIndex:10,background:"rgba(255,255,255,.95)",borderRadius:999,padding:"6px 16px",fontSize:12,fontWeight:500,color:"#475569",boxShadow:"0 2px 8px rgba(0,0,0,.12)",maxWidth:"90vw",textAlign:"center"}}>{!ready?"Loading map…":msg}</div>
      {/* match list */}
      {matches.length>0 && (
        <div style={{position:"absolute",top:76,left:12,zIndex:10,width:340,maxWidth:"92vw",maxHeight:"60vh",overflowY:"auto",background:"#fff",borderRadius:12,boxShadow:"0 8px 24px rgba(0,0,0,.18)"}}>
          <div style={{padding:"10px 14px",fontSize:11,fontWeight:700,letterSpacing:.5,textTransform:"uppercase",color:"#0891b2",borderBottom:"1px solid #f1f5f9"}}>Select your parcel</div>
          {matches.map((m,i)=>(
            <button key={i} onClick={()=>choose(m)} style={{display:"block",width:"100%",textAlign:"left",border:"none",borderBottom:"1px solid #f1f5f9",background:"#fff",padding:"10px 14px",cursor:"pointer"}}>
              <div style={{fontSize:14,color:"#0f172a",fontWeight:600}}>{m.address||"(no address on file)"}</div>
              <div style={{fontSize:12,color:"#64748b",fontFamily:"monospace"}}>APN {m.apn} · {m.acreage} ac</div>
            </button>
          ))}
        </div>
      )}
      {/* result panel */}
      {sel && (
        <div style={{position:"absolute",bottom:64,left:16,zIndex:10,width:320,maxWidth:"90vw",background:"#fff",borderRadius:12,padding:16,boxShadow:"0 8px 24px rgba(0,0,0,.18)"}}>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:.5,textTransform:"uppercase",color:"#0891b2"}}>{sel.label} County</div>
          <div style={{marginTop:10,fontSize:12,color:"#64748b"}}>APN</div>
          <div style={{fontFamily:"monospace",fontSize:16,fontWeight:700,color:"#0f172a"}}>{sel.apn}</div>
          {sel.address && (<><div style={{marginTop:8,fontSize:12,color:"#64748b"}}>Address</div><div style={{fontSize:14,color:"#0f172a"}}>{sel.address}</div></>)}
          <div style={{marginTop:8,fontSize:12,color:"#64748b"}}>Lot size</div>
          <div style={{fontSize:16,fontWeight:700,color:"#0f172a"}}>{sel.acreage} acres</div>
          <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid #f1f5f9",fontSize:11,color:"#94a3b8"}}>Next: zoning, buildable envelope, flood &amp; fire.</div>
        </div>
      )}
    </div>
  );
}
