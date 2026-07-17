"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Slug = "los_angeles" | "napa";
const VIEWS: Record<Slug,{c:[number,number];z:number;label:string}> = {
  los_angeles:{c:[-118.2437,34.0522],z:11,label:"Los Angeles"},
  napa:{c:[-122.2869,38.2975],z:12,label:"Napa"},
};
const STYLE = {version:8,sources:{carto:{type:"raster",tiles:["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png","https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png","https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"],tileSize:256,attribution:"© OpenStreetMap © CARTO"}},layers:[{id:"carto",type:"raster",source:"carto"}]} as unknown as maplibregl.StyleSpecification;

type Match = {apn:string;address:string;acreage:number;label:string;geometry:GeoJSON.Geometry;attrs:Record<string,any>};

const BC:Record<string,string>={green:"#dcfce7",amber:"#fef3c7",red:"#fee2e2",gray:"#f1f5f9"};
const BT:Record<string,string>={green:"#166534",amber:"#92400e",red:"#991b1b",gray:"#475569"};
function centroid(g:any){const polys=g.type==="Polygon"?[g.coordinates]:g.coordinates;let x=0,y=0,n=0;polys.forEach((pl:any)=>pl[0].forEach((c:any)=>{x+=c[0];y+=c[1];n++}));return[x/n,y/n]}
function money(v:any){const n=Number(v);return v==null||Number.isNaN(n)||n===0?null:"$"+n.toLocaleString(undefined,{maximumFractionDigits:0})}
function pickVal(a:Record<string,any>,names:string[]){for(const nm of names)for(const k in a){if(k.toLowerCase()===nm.toLowerCase()&&a[k]!=null&&String(a[k]).trim()!=="")return a[k]}return null}
function drawShape(doc:any,geo:any,x:number,y:number,w:number,h:number){
  const ring=geo?.type==="Polygon"?geo.coordinates[0]:geo?.coordinates?.[0]?.[0];
  if(!ring||!ring.length)return;
  let mnX=1e9,mnY=1e9,mxX=-1e9,mxY=-1e9;
  ring.forEach((c:any)=>{mnX=Math.min(mnX,c[0]);mxX=Math.max(mxX,c[0]);mnY=Math.min(mnY,c[1]);mxY=Math.max(mxY,c[1])});
  const dx=(mxX-mnX)||1,dy=(mxY-mnY)||1,s=Math.min(w/dx,h/dy);
  const ox=x+(w-dx*s)/2,oy=y+(h-dy*s)/2;
  const pts=ring.map((c:any)=>[ox+(c[0]-mnX)*s,oy+(mxY-c[1])*s]);
  const rel=pts.slice(1).map((p:any,i:number)=>[p[0]-pts[i][0],p[1]-pts[i][1]]);
  doc.setFillColor(207,242,250);doc.setDrawColor(14,116,144);doc.setLineWidth(0.5);
  doc.lines(rel,pts[0][0],pts[0][1],[1,1],"FD",true);
}

export default function Home(){
  const mapRef=useRef<maplibregl.Map|null>(null);
  const boxRef=useRef<HTMLDivElement|null>(null);
  const [county,setCounty]=useState<Slug>("napa");
  const [addr,setAddr]=useState("");
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("Search an address or APN, or tap the map.");
  const [matches,setMatches]=useState<Match[]>([]);
  const [sel,setSel]=useState<Match|null>(null);
  const [report,setReport]=useState<any>(null);
  const [repBusy,setRepBusy]=useState(false);
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
    const b=new maplibregl.LngLatBounds(), gg=g as any;
    (gg.type==="Polygon"?[gg.coordinates]:gg.coordinates).forEach((pl:any)=>pl.forEach((r:any)=>r.forEach((c:any)=>b.extend(c))));
    if(!b.isEmpty())m.fitBounds(b,{padding:60,maxZoom:17});
  }
  async function choose(mt:Match){
    setSel(mt);setMatches([]);draw(mt.geometry);setMsg(`${mt.label} County · ${mt.address||mt.apn}`);
    setReport(null);setRepBusy(true);
    const [lon,lat]=centroid(mt.geometry as any);
    try{
      const r=await fetch(`/api/feasibility?lon=${lon}&lat=${lat}&acres=${mt.acreage}&county=${mt.label==="Napa"?"napa":"los_angeles"}`);
      setReport(await r.json());
    }catch{setReport({error:true})}
    finally{setRepBusy(false)}
  }

  async function run(url:string,label:string){
    setBusy(true);setSel(null);setMatches([]);setReport(null);setMsg(label);
    try{
      const r=await fetch(url);const d=await r.json();
      if(d.status==="ok"&&d.matches?.length){
        const near=d.match==="nearby"||d.match==="approximate";
        if(d.matches.length===1&&!near){choose(d.matches[0])}
        else{setMatches(d.matches);draw(null);setMsg(near?"No address on file for that number — parcels at that spot, nearest first. Pick yours:":`${d.matches.length} parcels match — pick yours:`)}
      } else {draw(null);setMsg(d.message||"No parcel found.")}
    }catch{setMsg("Search failed — try again.")}
    finally{setBusy(false)}
  }
  const lookupPoint=(lat:number,lon:number)=>run(`/api/parcel?lat=${lat}&lon=${lon}`,"Fetching parcel…");
  const search=()=>{const q=addr.trim();if(q)run(`/api/parcel?q=${encodeURIComponent(q)}&county=${county}`,"Searching records…")};
  function jump(c:Slug){setCounty(c);mapRef.current?.flyTo({center:VIEWS[c].c,zoom:VIEWS[c].z})}

  async function downloadPDF(){
    if(!sel)return;
    const { jsPDF } = await import("jspdf");
    const doc:any = new jsPDF({unit:"mm",format:"a4"});
    const W=210,M=15;let y=0;
    const V=(n:string[])=>money(pickVal(sel.attrs,n));
    const vAssessed=V(["Roll_totalValue","TotalValue","total_val","NetValue","AssessedValue","ASSD_TOTAL","total_value"]);
    const vLand=V(["Roll_LandValue","LandValue","land_val","LAND_VAL","land_value"]);
    const uCode=pickVal(sel.attrs,["landuse1","LANDUSE","UseType","use_code","usecode","LandUse"]);
    const bb=report?.buildability||{}, rr=report?.risk||{};
    doc.setFillColor(15,23,42);doc.rect(0,0,W,26,"F");
    doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(20);doc.text("ORCA",M,16);
    doc.setFont("helvetica","normal");doc.setFontSize(9);doc.setTextColor(125,211,252);doc.text("PARCEL FEASIBILITY REPORT",M+21,16);
    doc.setTextColor(148,163,184);doc.setFontSize(8);doc.text(new Date().toLocaleDateString(),W-M,16,{align:"right"});
    y=38;
    doc.setTextColor(15,23,42);doc.setFont("helvetica","bold");doc.setFontSize(15);
    doc.text(sel.address||"Vacant parcel (no address on file)",M,y);
    drawShape(doc,sel.geometry,W-M-46,30,46,34);
    y+=7;doc.setFont("helvetica","normal");doc.setFontSize(10);doc.setTextColor(100,116,139);
    doc.text(`APN ${sel.apn}    ${sel.label} County    ${sel.acreage} acres`,M,y);
    const sec=(t:string)=>{y+=8;doc.setDrawColor(226,232,240);doc.line(M,y,W-M,y);y+=6;doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(8,145,178);doc.text(t,M,y);y+=6.5;doc.setFont("helvetica","normal");doc.setFontSize(10)};
    const row=(k:string,v:any,c?:number[])=>{doc.setTextColor(100,116,139);doc.setFont("helvetica","normal");doc.text(k,M,y);const col=c||[15,23,42];doc.setTextColor(col[0],col[1],col[2]);doc.setFont("helvetica","bold");doc.text(String(v),W-M,y,{align:"right"});y+=6.6};
    const RC:Record<string,number[]>={green:[22,101,52],amber:[146,64,14],red:[153,27,27],gray:[100,116,139]};
    sec("1.  What You Can Build");
    row("Zoning district",bb.code||"Not returned");
    if(bb.name)row("District",bb.name); if(bb.use)row("Primary use",bb.use); if(bb.minLot)row("Min lot / density",bb.minLot);
    row("Max dwellings (by density)",bb.maxUnits!=null?bb.maxUnits:"—",[8,145,178]);
    if(bb.envelope)row("Est. buildable footprint",bb.envelope.toLocaleString()+" sf");
    row("ADU potential","1 ADU + 1 JADU likely (CA state law)");
    sec("2.  What Could Stop a Deal");
    ([["Flood zone (FEMA)","flood"],["Fire hazard","fire"],["Williamson Act","williamson"],["Terrain","terrain"]] as const).forEach(([lab,k])=>{const r=rr[k as string];row(lab,r?r.text:"—",r?RC[r.level]:undefined)});
    sec("3.  Is It Worth It");
    if(uCode)row("Land use (county code)",String(uCode));
    row("Development capacity",bb.maxUnits!=null?`${bb.maxUnits} dwelling${bb.maxUnits===1?"":"s"} by right`:"—");
    row("Assessed value",vAssessed||"Not published in public layer");
    row("Assessed land value",vLand||"Not published in public layer");
    y=276;doc.setDrawColor(226,232,240);doc.line(M,y,W-M,y);y+=5;
    doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(148,163,184);
    doc.text(doc.splitTextToSize("Sources: county assessor parcel data, FEMA National Flood Hazard Layer, county hazard layers. Zoning is summarized for common districts — confirm against the county code and overlays. This is a rapid feasibility screen, not an appraisal or a substitute for professional due diligence.",W-2*M),M,y);
    doc.save(`Orca-Feasibility-${sel.apn.replace(/[^\w]/g,"")}.pdf`);
  }

  const b=report?.buildability, rk=report?.risk;
  const val=sel?money(pickVal(sel.attrs,["Roll_totalValue","TotalValue","total_val","NetValue","AssessedValue","ASSD_TOTAL","assd_total","total_value"])):null;
  const land=sel?money(pickVal(sel.attrs,["Roll_LandValue","LandValue","land_val","LAND_VAL","land_value"])):null;
  const useCode=sel?pickVal(sel.attrs,["landuse1","LANDUSE","UseType","use_code","usecode","LandUse"]):null;

  const S=(bg:string)=>({display:"inline-block",padding:"2px 9px",borderRadius:999,fontSize:11,fontWeight:700,background:BC[bg]||BC.gray,color:BT[bg]||BT.gray});
  const kv=(k:string,v:any)=>(<div style={{display:"flex",justifyContent:"space-between",gap:12,padding:"8px 0",borderBottom:"1px solid #f4f6f9",fontSize:13}}><span style={{color:"#64748b"}}>{k}</span><span style={{fontWeight:600,textAlign:"right"}}>{v}</span></div>);
  const H=(t:string)=>(<div style={{fontSize:11,fontWeight:800,letterSpacing:.5,textTransform:"uppercase",color:"#0891b2",margin:"16px 0 4px"}}>{t}</div>);

  return (
    <div style={{position:"relative",height:"100vh",width:"100vw",overflow:"hidden",fontFamily:"system-ui,-apple-system,sans-serif"}}>
      <div ref={boxRef} style={{position:"absolute",inset:0,background:"#eef2f5"}}/>
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

      {!sel && matches.length===0 && (
        <div style={{position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",zIndex:10,background:"rgba(255,255,255,.95)",borderRadius:999,padding:"6px 16px",fontSize:12,fontWeight:500,color:"#475569",boxShadow:"0 2px 8px rgba(0,0,0,.12)",maxWidth:"90vw",textAlign:"center"}}>{!ready?"Loading map…":msg}</div>
      )}

      {matches.length>0 && (
        <div style={{position:"absolute",top:76,left:12,zIndex:10,width:360,maxWidth:"92vw",maxHeight:"64vh",overflowY:"auto",background:"#fff",borderRadius:12,boxShadow:"0 8px 24px rgba(0,0,0,.18)"}}>
          <div style={{padding:"12px 16px",fontSize:12,fontWeight:700,color:"#334155",borderBottom:"1px solid #f1f5f9"}}>{msg}</div>
          {matches.map((m,i)=>(
            <button key={i} onClick={()=>choose(m)} style={{display:"block",width:"100%",textAlign:"left",border:"none",borderBottom:"1px solid #f1f5f9",background:"#fff",padding:"11px 16px",cursor:"pointer"}}>
              <div style={{fontSize:14,color:"#0f172a",fontWeight:600}}>{m.address||"(no address on file)"}</div>
              <div style={{fontSize:12,color:"#64748b",fontFamily:"monospace"}}>APN {m.apn} · {m.acreage} ac</div>
            </button>
          ))}
        </div>
      )}

      {sel && (
        <div style={{position:"absolute",top:72,left:12,zIndex:10,width:380,maxWidth:"94vw",maxHeight:"84vh",overflowY:"auto",background:"#fff",borderRadius:14,boxShadow:"0 10px 30px rgba(0,0,0,.2)"}}>
          <div style={{padding:"14px 18px",borderBottom:"1px solid #eef2f6",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:11,fontWeight:800,letterSpacing:.5,textTransform:"uppercase",color:"#0891b2"}}>{sel.label} County · Feasibility</div>
              <div style={{fontSize:18,fontWeight:800,marginTop:2}}>{sel.address||"(vacant — no address on file)"}</div>
              <div style={{fontSize:12,color:"#64748b",fontFamily:"monospace",marginTop:2}}>APN {sel.apn} · {sel.acreage} acres</div>
            </div>
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              <button onClick={downloadPDF} disabled={repBusy} title="Download investor PDF" style={{border:"none",background:"#0891b2",color:"#fff",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:700,opacity:repBusy?.5:1}}>PDF</button>
              <button onClick={()=>{setSel(null);setReport(null);draw(null);setMsg("Search an address or APN, or tap the map.")}} style={{border:"none",background:"#f1f5f9",borderRadius:8,width:30,height:30,cursor:"pointer",fontSize:16,color:"#64748b"}}>×</button>
            </div>
          </div>

          <div style={{padding:"0 18px 18px"}}>
            {H("① What you can build")}
            {repBusy && !report ? <div style={{fontSize:13,color:"#94a3b8",padding:"8px 0"}}>Reading zoning…</div> : b?.error ? <div style={{fontSize:13,color:"#94a3b8",padding:"8px 0"}}>Zoning layer didn't respond — verify with county.</div> : (<>
              {kv("Zoning district", b?.code ? <span style={S("gray")}>{b.code}</span> : <span style={S("amber")}>not returned</span>)}
              {b?.name && kv("District", b.name)}
              {b?.use && kv("Primary use", b.use)}
              {b?.minLot && kv("Min lot / density", b.minLot)}
              {kv("Max dwellings (by density)", <span style={{fontSize:18,fontWeight:800,color:"#0891b2"}}>{b?.maxUnits!=null?b.maxUnits:"—"}</span>)}
              {b?.envelope && kv("Est. buildable footprint", b.envelope.toLocaleString()+" sf")}
              {kv("ADU potential", <span style={S("green")}>1 ADU + 1 JADU likely</span>)}
              {b?.cite && <div style={{fontSize:11,color:"#94a3b8",marginTop:6}}>Density/setbacks summarized from {b.cite}; confirm overlays at permitting.</div>}
            </>)}

            {H("② What could stop a deal")}
            {["flood","fire","williamson","terrain"].map(key=>{
              const r=rk?.[key]; const labels:Record<string,string>={flood:"Flood zone (FEMA)",fire:"Fire hazard",williamson:"Williamson Act",terrain:"Terrain"};
              return kv(labels[key], repBusy&&!r?"…":r?<span style={S(r.level)}>{r.text}</span>:"—");
            })}

            {H("③ Is it worth it")}
            {useCode && kv("Land use (county code)", String(useCode))}
            {kv("Development capacity", b?.maxUnits!=null?<b>{b.maxUnits} dwelling{b.maxUnits===1?"":"s"} by right</b>:"—")}
            {kv("Assessed value", val||<span style={{color:"#94a3b8"}}>not in public layer</span>)}
            {kv("Assessed land value", land||<span style={{color:"#94a3b8"}}>not in public layer</span>)}
            {val && kv("Value / acre", money((Number(pickVal(sel.attrs,["Roll_totalValue","TotalValue","total_val","NetValue","AssessedValue","ASSD_TOTAL","total_value"]))||0)/sel.acreage))}
            <div style={{fontSize:11,color:"#94a3b8",marginTop:6}}>Public assessor values trail market and some counties don't publish them here. Size the opportunity from the max-dwellings figure × achievable per-unit value from comps.</div>

            <div style={{marginTop:16,padding:"10px 12px",background:"#f8fafc",borderRadius:10,fontSize:11,color:"#94a3b8",lineHeight:1.5}}>Zoning rules are summarized for common districts and must be confirmed against the county code and overlays (setback, hillside, SEA). Not an appraisal — a fast go/no-go, not a substitute for due diligence.</div>
          </div>
        </div>
      )}
    </div>
  );
}
