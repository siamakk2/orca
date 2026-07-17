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

type Match = {apn:string;address:string;acreage:number;label:string;geometry:GeoJSON.Geometry;attrs:Record<string,any>;zoning?:string;zoning_description?:string};

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
  const [analysis,setAnalysis]=useState<string|null>(null);
  const [anaBusy,setAnaBusy]=useState(false);
  const [aiFlag,setAiFlag]=useState(false);
  const [activity,setActivity]=useState<string|null>(null);
  const [actBusy,setActBusy]=useState(false);
  const [actEnabled,setActEnabled]=useState(true);
  const [actSources,setActSources]=useState<string[]>([]);
  const [zoning,setZoning]=useState<any>(null);
  const [znBusy,setZnBusy]=useState(false);
  const [znSources,setZnSources]=useState<string[]>([]);
  const [ready,setReady]=useState(false);
  const [embed,setEmbed]=useState(false);
  const [brand,setBrand]=useState<string>("");
  useEffect(()=>{try{const sp=new URLSearchParams(window.location.search);setEmbed(sp.get("embed")==="1"||sp.get("embed")==="true");setBrand(sp.get("brand")||"")}catch{}},[]);

  useEffect(()=>{
    if(mapRef.current||!boxRef.current)return;
    const m=new maplibregl.Map({container:boxRef.current,style:STYLE,center:[-119.4,37.15],zoom:5.5});
    mapRef.current=m;
    m.addControl(new maplibregl.NavigationControl(),"top-right");
    m.on("load",()=>{
      m.resize();setReady(true);
      m.addSource("p",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
      m.addLayer({id:"pf",type:"fill",source:"p",paint:{"fill-color":"#2563eb","fill-opacity":0.28}});
      m.addLayer({id:"pl",type:"line",source:"p",paint:{"line-color":"#1e40af","line-width":2.5}});
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
    setReport(null);setRepBusy(true);setAnalysis(null);
    const [lon,lat]=centroid(mt.geometry as any);
    const cSlug=mt.label==="Napa"?"napa":mt.label==="Los Angeles"?"los_angeles":mt.label.toLowerCase().replace(/\s+/g,"_");
    const zoneQ=mt.zoning?`&zone=${encodeURIComponent(mt.zoning)}`:"";
    const zdescQ=mt.zoning_description?`&zdesc=${encodeURIComponent(mt.zoning_description)}`:"";
    let rep:any=null;
    try{
      const r=await fetch(`/api/feasibility?lon=${lon}&lat=${lat}&acres=${mt.acreage}&county=${cSlug}${zoneQ}${zdescQ}`);
      rep=await r.json();setReport(rep);
    }catch{setReport({error:true})}
    finally{setRepBusy(false)}
    setAnaBusy(true);
    try{
      const uCode=pickVal(mt.attrs,["usedesc","landuse1","LANDUSE","UseType","use_code","usecode","LandUse"]);
      const assessed=money(pickVal(mt.attrs,["Roll_totalValue","TotalValue","total_val","NetValue","AssessedValue","ASSD_TOTAL","total_value","parval","saleprice"]));
      const landv=money(pickVal(mt.attrs,["Roll_LandValue","LandValue","land_val","LAND_VAL","land_value","landval"]));
      const ar=await fetch("/api/analysis",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({address:mt.address,apn:mt.apn,acreage:mt.acreage,county:mt.label,buildability:rep?.buildability,risk:rep?.risk,useCode:uCode,assessed,land:landv})});
      const aj=await ar.json();setAnalysis(aj.narrative||null);setAiFlag(!!aj.ai);
    }catch{setAnalysis(null)}
    finally{setAnaBusy(false)}
    // Area development activity + zoning intelligence (web-searched, in parallel)
    setActBusy(true);setActivity(null);
    setZnBusy(true);setZoning(null);setZnSources([]);
    const actP=fetch("/api/activity",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({address:mt.address,county:mt.label,apn:mt.apn})})
      .then(r=>r.json()).then(aj=>{setActEnabled(aj.enabled!==false);setActivity(aj.briefing||null);setActSources(aj.sources||[])})
      .catch(()=>setActivity(null)).finally(()=>setActBusy(false));
    const znP=fetch("/api/zoning",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({address:mt.address,county:mt.label,apn:mt.apn,acreage:mt.acreage,zoning:mt.zoning})})
      .then(r=>r.json()).then(zj=>{setZoning(zj.report||null);setZnSources(zj.sources||[])})
      .catch(()=>setZoning(null)).finally(()=>setZnBusy(false));
    await Promise.allSettled([actP,znP]);
  }

  async function run(url:string,label:string){
    setBusy(true);setSel(null);setMatches([]);setReport(null);setMsg(label);
    try{
      const r=await fetch(url);const d=await r.json();
      if(d.status==="ok"&&d.matches?.length){
        const near=d.match==="nearby"||d.match==="approximate";
        const street=d.match==="street";
        if(d.matches.length===1&&!near){choose(d.matches[0])}
        else{setMatches(d.matches);draw(null);setMsg(near?"No address on file for that number — parcels at that spot, nearest first. Pick yours:":street?"That exact number isn't in the county address book — here are the lots on that road. Pick yours:":`${d.matches.length} parcels match — pick yours:`)}
      } else {draw(null);setMsg(d.message||"No parcel found.")}
    }catch{setMsg("Search failed — try again.")}
    finally{setBusy(false)}
  }
  const lookupPoint=(lat:number,lon:number)=>run(`/api/parcel?lat=${lat}&lon=${lon}`,"Fetching parcel…");
  const search=()=>{const q=addr.trim();if(q)run(`/api/parcel?q=${encodeURIComponent(q)}`,"Searching California records…")};
  function jump(c:Slug){setCounty(c);mapRef.current?.flyTo({center:VIEWS[c].c,zoom:VIEWS[c].z})}

  async function downloadPDF(){
    if(!sel)return;
    const { jsPDF } = await import("jspdf");
    const doc:any = new jsPDF({unit:"mm",format:"a4"});
    const W=210,M=15;let y=0;
    const V=(n:string[])=>money(pickVal(sel.attrs,n));
    const vAssessed=V(["Roll_totalValue","TotalValue","total_val","NetValue","AssessedValue","ASSD_TOTAL","total_value","parval","saleprice"]);
    const vLand=V(["Roll_LandValue","LandValue","land_val","LAND_VAL","land_value","landval"]);
    const uCode=pickVal(sel.attrs,["usedesc","landuse1","LANDUSE","UseType","use_code","usecode","LandUse"]);
    const bb=report?.buildability||{}, rr=report?.risk||{};
    try{
      const blob=await (await fetch("/k2-logo.png")).blob();
      const durl:string=await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result as string);r.readAsDataURL(blob)});
      doc.addImage(durl,"PNG",M,6,15,15);
    }catch{}
    doc.setTextColor(15,23,42);doc.setFont("helvetica","bold");doc.setFontSize(17);doc.text("K2 INVESTMENT",M+19,13.5);
    doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(37,99,235);doc.text("PARCEL FEASIBILITY REPORT",M+19,19);
    doc.setTextColor(148,163,184);doc.setFontSize(8);doc.text(new Date().toLocaleDateString(),W-M,13.5,{align:"right"});
    doc.setDrawColor(226,232,240);doc.setLineWidth(0.4);doc.line(M,25,W-M,25);
    y=38;
    doc.setTextColor(15,23,42);doc.setFont("helvetica","bold");doc.setFontSize(15);
    doc.text(sel.address||"Vacant parcel (no address on file)",M,y);
    drawShape(doc,sel.geometry,W-M-46,30,46,34);
    y+=7;doc.setFont("helvetica","normal");doc.setFontSize(10);doc.setTextColor(100,116,139);
    doc.text(`APN ${sel.apn}    ${sel.label} County    ${sel.acreage} acres`,M,y);
    if(report){
      y+=8;
      doc.setFillColor(15,23,42);doc.roundedRect(M,y,44,28,2,2,"F");
      doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(21);doc.text(String(score),M+22,y+15,{align:"center"});
      doc.setFont("helvetica","normal");doc.setFontSize(6.5);doc.setTextColor(148,163,184);doc.text("PROJECT SCORE /100",M+22,y+21,{align:"center"});
      const kx=M+54, kw=(W-M-kx)/3;
      ([["Development",potential.t],["Regulatory risk",regRisk.t],["Market demand",demand.t]] as [string,string][]).forEach((k,i)=>{
        const x=kx+i*kw;
        doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(100,116,139);doc.text(k[0],x,y+9);
        doc.setFont("helvetica","bold");doc.setFontSize(13);doc.setTextColor(15,23,42);doc.text(k[1],x,y+20);
      });
      y+=34;
    }
    if(analysis){
      y+=10;doc.setDrawColor(226,232,240);doc.line(M,y,W-M,y);y+=6;
      doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(37,99,235);doc.text("INVESTOR ANALYSIS"+(aiFlag?"  (AI)":""),M,y);y+=6;
      doc.setFont("helvetica","normal");doc.setFontSize(9.5);doc.setTextColor(30,41,59);
      doc.splitTextToSize(analysis.replace(/\*\*/g,""),W-2*M).forEach((ln:string)=>{if(y>276){doc.addPage();y=20}doc.text(ln,M,y);y+=5});
    }
    const sec=(t:string)=>{if(y>250){doc.addPage();y=20}y+=8;doc.setDrawColor(226,232,240);doc.line(M,y,W-M,y);y+=6;doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(37,99,235);doc.text(t,M,y);y+=6.5;doc.setFont("helvetica","normal");doc.setFontSize(10)};
    const row=(k:string,v:any,c?:number[])=>{if(y>278){doc.addPage();y=20}doc.setTextColor(100,116,139);doc.setFont("helvetica","normal");doc.text(k,M,y);const col=c||[15,23,42];doc.setTextColor(col[0],col[1],col[2]);doc.setFont("helvetica","bold");doc.text(String(v),W-M,y,{align:"right"});y+=6.6};
    const RC:Record<string,number[]>={green:[22,101,52],amber:[146,64,14],red:[153,27,27],gray:[100,116,139]};
    sec("1.  What You Can Build");
    row("Zoning district",bb.code||"Not returned");
    if(bb.name)row("District",bb.name); if(bb.use)row("Primary use",bb.use); if(bb.minLot)row("Min lot / density",bb.minLot);
    row("Max dwellings (by density)",bb.maxUnits!=null?bb.maxUnits:"—",[37,99,235]);
    if(bb.envelope)row("Est. buildable footprint",bb.envelope.toLocaleString()+" sf");
    row("ADU potential","1 ADU + 1 JADU likely (CA state law)");
    if(zoning){
      sec("Zoning & Entitlement Intelligence"+(zoning.confidence?`  (${zoning.confidence} confidence)`:""));
      if(zoning.zone)row("Governing zone",zoning.zone);
      if(zoning.jurisdiction)row("Jurisdiction",zoning.jurisdiction);
      if(zoning.summary){doc.setFont("helvetica","normal");doc.setFontSize(9.5);doc.setTextColor(30,41,59);doc.splitTextToSize(zoning.summary,W-2*M).forEach((ln:string)=>{if(y>276){doc.addPage();y=20}doc.text(ln,M,y);y+=5})}
      if(Array.isArray(zoning.standards))zoning.standards.filter((s:any)=>s&&s.value).forEach((s:any)=>row(s.label,String(s.value)));
      const para=(lab:string,txt:string)=>{if(!txt)return;if(y>270){doc.addPage();y=20}y+=1.5;doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(124,58,237);doc.text(lab,M,y);y+=5;doc.setFont("helvetica","normal");doc.setFontSize(9.5);doc.setTextColor(30,41,59);doc.splitTextToSize(txt,W-2*M).forEach((ln:string)=>{if(y>276){doc.addPage();y=20}doc.text(ln,M,y);y+=5})};
      para("ADUs",zoning.adu);para("Upside",zoning.opportunities);para("Process",zoning.process);
      if(Array.isArray(zoning.flags)&&zoning.flags.length){if(y>268){doc.addPage();y=20}y+=1.5;doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(194,65,12);doc.text("Could stop or delay a deal",M,y);y+=5;doc.setFont("helvetica","normal");doc.setFontSize(9.5);doc.setTextColor(154,52,18);zoning.flags.forEach((f:string)=>{doc.splitTextToSize("- "+f,W-2*M).forEach((ln:string)=>{if(y>276){doc.addPage();y=20}doc.text(ln,M,y);y+=5})})}
      if(znSources&&znSources.length){if(y>274){doc.addPage();y=20}doc.setFont("helvetica","italic");doc.setFontSize(7.5);doc.setTextColor(148,163,184);doc.text("Zoning sources: "+znSources.join(", "),M,y);y+=5}
    }
    sec("2.  What Could Stop a Deal");
    ([["Flood zone (FEMA)","flood"],["Fire hazard","fire"],["Williamson Act","williamson"],["Terrain","terrain"]] as const).forEach(([lab,k])=>{const r=rr[k as string];row(lab,r?r.text:"—",r?RC[r.level]:undefined)});
    sec("3.  Is It Worth It");
    if(uCode)row("Land use (county code)",String(uCode));
    row("Development capacity",bb.maxUnits!=null?`${bb.maxUnits} dwelling${bb.maxUnits===1?"":"s"} by right`:"—");
    row("Assessed value",vAssessed||"Not published in public layer");
    row("Assessed land value",vLand||"Not published in public layer");
    if(analysis && activity){
      sec("4.  What's Happening Nearby");
      doc.setFont("helvetica","normal");doc.setFontSize(9.5);doc.setTextColor(30,41,59);
      doc.splitTextToSize(activity,W-2*M).forEach((ln:string)=>{if(y>276){doc.addPage();y=20}doc.text(ln,M,y);y+=5});
    }
    if(y>270){doc.addPage();y=20}else{y+=6}
    doc.setDrawColor(226,232,240);doc.line(M,y,W-M,y);y+=5;
    doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(148,163,184);
    doc.text(doc.splitTextToSize("Sources: county assessor parcel data, FEMA National Flood Hazard Layer, county hazard layers. Zoning is summarized for common districts — confirm against the county code and overlays. This is a rapid feasibility screen, not an appraisal or a substitute for professional due diligence.",W-2*M),M,y);
    doc.save(`Orca-Feasibility-${sel.apn.replace(/[^\w]/g,"")}.pdf`);
  }

  const b=report?.buildability, rk=report?.risk;
  // ---- investor dashboard scoring (heuristic screen, not an appraisal) ----
  const u = b?.maxUnits;
  const potential = u==null ? {t:"—",c:"gray"} : u>=5 ? {t:"Premium",c:"green"} : u>=2 ? {t:"Strong",c:"green"} : u===1 ? {t:"Single-dwelling",c:"amber"} : {t:"Limited",c:"amber"};
  const riskFlags = [rk?.flood,rk?.fire,rk?.williamson,rk?.terrain].filter(Boolean) as any[];
  const anyRed = riskFlags.some(f=>f.level==="red");
  const anyAmber = riskFlags.some(f=>f.level==="amber");
  const regRisk = !report ? {t:"—",c:"gray"} : anyRed ? {t:"High",c:"red"} : anyAmber ? {t:"Medium",c:"amber"} : {t:"Low",c:"green"};
  const demand = !actEnabled ? {t:"—",c:"gray"} : (actBusy&&!activity) ? {t:"…",c:"gray"} : activity && /data center|industrial|warehouse|logistics|growth|expansion|boom|corridor|construction|development|approved|proposed/i.test(activity) ? {t:"Strong",c:"green"} : activity ? {t:"Moderate",c:"amber"} : {t:"Quiet",c:"gray"};
  let score = 55;
  if(u!=null) score += Math.min(24, u*4);
  if(rk?.flood?.level==="red") score -= 16;
  if(rk?.fire){ if(/very high/i.test(rk.fire.text)) score -= 12; else if(/high/i.test(rk.fire.text)) score -= 7; else if(rk.fire.level==="amber") score -= 3; }
  if(rk?.williamson?.level==="red") score -= 20;
  if(rk?.terrain?.level==="amber") score -= 3;
  if(demand.t==="Strong") score += 8; else if(demand.t==="Moderate") score += 3;
  score = Math.max(12, Math.min(97, Math.round(score)));
  const via = score>=80?{t:"High viability",c:"#16a34a"}:score>=62?{t:"Solid",c:"#2563eb"}:score>=45?{t:"Moderate",c:"#b45309"}:{t:"Challenged",c:"#dc2626"};
  const val=sel?money(pickVal(sel.attrs,["Roll_totalValue","TotalValue","total_val","NetValue","AssessedValue","ASSD_TOTAL","assd_total","total_value"])):null;
  const land=sel?money(pickVal(sel.attrs,["Roll_LandValue","LandValue","land_val","LAND_VAL","land_value","landval"])):null;
  const useCode=sel?pickVal(sel.attrs,["usedesc","landuse1","LANDUSE","UseType","use_code","usecode","LandUse"]):null;

  const S=(bg:string)=>({display:"inline-block",padding:"2px 9px",borderRadius:999,fontSize:11,fontWeight:700,background:BC[bg]||BC.gray,color:BT[bg]||BT.gray});
  const kv=(k:string,v:any)=>(<div style={{display:"flex",justifyContent:"space-between",gap:12,padding:"8px 0",borderBottom:"1px solid #f4f6f9",fontSize:13}}><span style={{color:"#64748b"}}>{k}</span><span style={{fontWeight:600,textAlign:"right"}}>{v}</span></div>);
  const H=(t:string)=>(<div style={{fontSize:11,fontWeight:800,letterSpacing:.5,textTransform:"uppercase",color:"#1d4ed8",margin:"16px 0 4px"}}>{t}</div>);

  return (
    <div style={{position:"relative",height:"100vh",width:"100vw",overflow:"hidden",fontFamily:"system-ui,-apple-system,sans-serif"}}>
      <div ref={boxRef} style={{position:"absolute",inset:0,background:"#eef2f5"}}/>
      <div style={{position:"absolute",top:0,left:0,right:0,zIndex:10,display:"flex",flexWrap:"wrap",gap:8,padding:12,alignItems:"flex-start",justifyContent:"space-between"}}>
        <a href={embed?"https://parcels.k2investments.com":"/"} target={embed?"_blank":undefined} rel={embed?"noopener":undefined} style={{textDecoration:"none",display:"flex",alignItems:"center",gap:10,background:"#fff",borderRadius:12,padding:"7px 14px",boxShadow:"0 4px 14px rgba(0,0,0,.15)"}}>
          <img src="/k2-logo.png" alt="K2" style={{height:30,width:30,objectFit:"contain"}}/>
          {brand
            ? <span style={{color:"#0f172a",fontWeight:800,fontSize:15,letterSpacing:-.3,lineHeight:1.05}}>{brand}<br/><span style={{fontSize:9,fontWeight:600,color:"#64748b"}}>powered by K2 Investment</span></span>
            : <span style={{color:"#0f172a",fontWeight:800,fontSize:16,letterSpacing:-.3}}>K2&nbsp;<span style={{color:"#2563eb"}}>Investment</span></span>}
          <span style={{fontSize:11,fontWeight:700,color:"#2563eb",background:"#eff6ff",padding:"3px 9px",borderRadius:999,marginLeft:2}}>California</span>
        </a>
        <div style={{display:"flex",gap:8,background:"#fff",borderRadius:12,padding:8,boxShadow:"0 4px 14px rgba(0,0,0,.15)",flex:"1 1 320px",maxWidth:460}}>
          <input value={addr} onChange={e=>setAddr(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")search()}} placeholder="Enter any California address or APN…" style={{flex:1,minWidth:0,border:"none",outline:"none",fontSize:14,padding:"8px 10px",color:"#0f172a"}}/>
          <button onClick={search} disabled={busy} style={{border:"none",borderRadius:8,background:"#2563eb",color:"#fff",fontWeight:600,fontSize:14,padding:"8px 16px",cursor:"pointer",opacity:busy?.5:1}}>{busy?"…":"Search"}</button>
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
              <div style={{fontSize:11,fontWeight:800,letterSpacing:.5,textTransform:"uppercase",color:"#1d4ed8"}}>{sel.label} County · Feasibility</div>
              <div style={{fontSize:18,fontWeight:800,marginTop:2}}>{sel.address||"(vacant — no address on file)"}</div>
              <div style={{fontSize:12,color:"#64748b",fontFamily:"monospace",marginTop:2}}>APN {sel.apn} · {sel.acreage} acres</div>
            </div>
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              <button onClick={downloadPDF} disabled={repBusy} title="Download investor PDF" style={{border:"none",background:"#1d4ed8",color:"#fff",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:700,opacity:repBusy?.5:1}}>PDF</button>
              <button onClick={()=>{setSel(null);setReport(null);draw(null);setMsg("Search an address or APN, or tap the map.")}} style={{border:"none",background:"#f1f5f9",borderRadius:8,width:30,height:30,cursor:"pointer",fontSize:16,color:"#64748b"}}>×</button>
            </div>
          </div>

          <div style={{padding:"0 18px 18px"}}>
            {report && (
              <div style={{marginTop:14,display:"flex",gap:10}}>
                <div style={{flex:"0 0 118px",background:"#0f172a",borderRadius:12,padding:"12px 14px",color:"#fff"}}>
                  <div style={{fontSize:9,fontWeight:700,letterSpacing:.5,textTransform:"uppercase",color:"#94a3b8"}}>Project Score</div>
                  <div style={{fontSize:30,fontWeight:800,lineHeight:1.1,marginTop:2}}>{score}<span style={{fontSize:13,color:"#94a3b8",fontWeight:600}}>/100</span></div>
                  <div style={{fontSize:11,fontWeight:700,marginTop:2,color:via.c==="#2563eb"?"#7dd3fc":via.c==="#16a34a"?"#86efac":via.c==="#b45309"?"#fcd34d":"#fca5a5"}}>{via.t}</div>
                </div>
                <div style={{flex:1,display:"flex",flexDirection:"column",gap:6}}>
                  {([["Development",potential],["Regulatory risk",regRisk],["Market demand",demand]] as [string,{t:string;c:string}][]).map(([lab,k])=>(
                    <div key={lab} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#f8fafc",borderRadius:8,padding:"7px 11px"}}>
                      <span style={{fontSize:11.5,color:"#64748b",fontWeight:500}}>{lab}</span>
                      <span style={S(k.c)}>{k.t}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{marginTop:14,padding:"14px 16px",background:"linear-gradient(135deg,#eff6ff,#f0f9ff)",border:"1px solid #dbeafe",borderRadius:12}}>
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,fontWeight:800,letterSpacing:.5,textTransform:"uppercase",color:"#2563eb",marginBottom:8}}>
                <span>◆ Investor Analysis</span>{aiFlag&&<span style={{fontSize:9,background:"#2563eb",color:"#fff",padding:"1px 6px",borderRadius:999}}>AI</span>}
              </div>
              {anaBusy&&!analysis ? <div style={{fontSize:13,color:"#64748b"}}>Analyzing the deal…</div>
                : analysis ? <div style={{fontSize:13,lineHeight:1.6,color:"#1e293b",whiteSpace:"pre-wrap"}}>{analysis.replace(/\*\*/g,"")}</div>
                : <div style={{fontSize:13,color:"#94a3b8"}}>Analysis unavailable.</div>}
            </div>

            {H("① What you can build")}
            {repBusy && !report ? <div style={{fontSize:13,color:"#94a3b8",padding:"8px 0"}}>Reading zoning…</div> : b?.error ? <div style={{fontSize:13,color:"#94a3b8",padding:"8px 0"}}>Zoning layer didn't respond — verify with county.</div> : (<>
              {kv("Zoning district", b?.code ? <span style={S("gray")}>{b.code}</span> : <span style={S("amber")}>not returned</span>)}
              {b?.name && kv("District", b.name)}
              {b?.use && kv("Primary use", b.use)}
              {b?.minLot && kv("Min. parcel size (this zone)", b.minLot)}
              {kv("Max dwellings (by density)", <span style={{fontSize:18,fontWeight:800,color:"#1d4ed8"}}>{b?.maxUnits!=null?b.maxUnits:"—"}</span>)}
              {b?.envelope && kv("Est. buildable footprint", b.envelope.toLocaleString()+" sf")}
              {kv("ADU potential", <span style={S("green")}>1 ADU + 1 JADU likely</span>)}
              {b?.cite && <div style={{fontSize:11,color:"#94a3b8",marginTop:6}}>Density/setbacks summarized from {b.cite}; confirm overlays at permitting.</div>}
            </>)}

            <div style={{marginTop:16,padding:"14px 16px",background:"linear-gradient(135deg,#faf5ff,#f5f3ff)",border:"1px solid #e9d5ff",borderRadius:12}}>
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,fontWeight:800,letterSpacing:.5,textTransform:"uppercase",color:"#7c3aed",marginBottom:8}}>
                <span>⬡ Zoning &amp; Entitlement Intelligence</span>
                <span style={{fontSize:9,background:"#7c3aed",color:"#fff",padding:"1px 6px",borderRadius:999}}>AI</span>
                {zoning?.confidence && <span style={{fontSize:9,marginLeft:"auto",fontWeight:700,padding:"1px 7px",borderRadius:999,background:zoning.confidence==="high"?"#dcfce7":zoning.confidence==="medium"?"#fef3c7":"#f1f5f9",color:zoning.confidence==="high"?"#15803d":zoning.confidence==="medium"?"#b45309":"#64748b"}}>{zoning.confidence} confidence</span>}
              </div>
              {znBusy && !zoning ? <div style={{fontSize:13,color:"#64748b"}}>Researching the governing zoning code, general plan, and state overrides…</div>
                : zoning ? <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:"#1e293b"}}>{zoning.zone||"Zone not confirmed"}</div>
                      {zoning.jurisdiction && <div style={{fontSize:12,color:"#7c3aed"}}>{zoning.jurisdiction}</div>}
                    </div>
                    {zoning.summary && <div style={{fontSize:13,lineHeight:1.6,color:"#1e293b"}}>{zoning.summary}</div>}
                    {Array.isArray(zoning.permittedUses)&&zoning.permittedUses.length>0 && <div>
                      <div style={{fontSize:10,fontWeight:700,letterSpacing:.4,textTransform:"uppercase",color:"#94a3b8"}}>Permitted uses</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:5}}>{zoning.permittedUses.map((u:string,i:number)=><span key={i} style={{fontSize:11,background:"#fff",border:"1px solid #e9d5ff",color:"#334155",padding:"3px 9px",borderRadius:999}}>{u}</span>)}</div>
                    </div>}
                    {Array.isArray(zoning.standards)&&zoning.standards.filter((s:any)=>s?.value).length>0 && <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      {zoning.standards.filter((s:any)=>s?.value).map((s:any,i:number)=>kv(s.label,String(s.value)))}
                    </div>}
                    {zoning.adu && <div style={{fontSize:12.5,lineHeight:1.55,color:"#1e293b"}}><b style={{color:"#7c3aed"}}>ADUs — </b>{zoning.adu}</div>}
                    {zoning.opportunities && <div style={{fontSize:12.5,lineHeight:1.55,color:"#1e293b"}}><b style={{color:"#7c3aed"}}>Upside — </b>{zoning.opportunities}</div>}
                    {zoning.process && <div style={{fontSize:12.5,lineHeight:1.55,color:"#1e293b"}}><b style={{color:"#7c3aed"}}>Process — </b>{zoning.process}</div>}
                    {Array.isArray(zoning.flags)&&zoning.flags.length>0 && <div style={{background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:8,padding:"8px 11px"}}>
                      <div style={{fontSize:10.5,fontWeight:800,letterSpacing:.3,textTransform:"uppercase",color:"#c2410c",marginBottom:4}}>Could stop or delay a deal</div>
                      {zoning.flags.map((f:string,i:number)=><div key={i} style={{fontSize:12,color:"#9a3412",lineHeight:1.5}}>• {f}</div>)}
                    </div>}
                    {znSources.length>0 && <div style={{fontSize:11,color:"#a78bda"}}>Sources: {znSources.join(" · ")}</div>}
                  </div>
                : <div style={{fontSize:12.5,color:"#64748b",lineHeight:1.55}}>Couldn't pin the exact governing zone from public sources for this parcel — treat zoning as unconfirmed and verify the district and standards directly with the planning department. (Turns on with an Anthropic API key.)</div>}
            </div>

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
            {val && kv("Value / acre", money((Number(pickVal(sel.attrs,["Roll_totalValue","TotalValue","total_val","NetValue","AssessedValue","ASSD_TOTAL","total_value","parval","saleprice"]))||0)/sel.acreage))}
            <div style={{fontSize:11,color:"#94a3b8",marginTop:6}}>Public assessor values trail market and some counties don't publish them here. Size the opportunity from the max-dwellings figure × achievable per-unit value from comps.</div>

            {H("④ What's happening nearby")}
            {!actEnabled ? <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.5}}>Area development intelligence turns on with an Anthropic API key — it web-searches for nearby data centers, industrial, and commercial projects and reads what they mean for land value here.</div>
              : actBusy && !activity ? <div style={{fontSize:13,color:"#64748b"}}>Scanning the area for major developments…</div>
              : activity ? <><div style={{fontSize:13,lineHeight:1.6,color:"#1e293b",whiteSpace:"pre-wrap"}}>{activity}</div>{actSources.length>0 && <div style={{fontSize:11,color:"#94a3b8",marginTop:8}}>Sources: {actSources.join(" · ")}</div>}</>
              : <div style={{fontSize:12,color:"#94a3b8"}}>No notable nearby development activity found.</div>}

            <div style={{marginTop:16,padding:"10px 12px",background:"#f8fafc",borderRadius:10,fontSize:11,color:"#94a3b8",lineHeight:1.5}}>Zoning rules are summarized for common districts and must be confirmed against the county code and overlays (setback, hillside, SEA). Not an appraisal — a fast go/no-go, not a substitute for due diligence.</div>
          </div>
        </div>
      )}
    </div>
  );
}
