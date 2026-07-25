import Link from "next/link";

export default function Landing() {
  return (
    <main>
      <style dangerouslySetInnerHTML={{__html: CSS}} />

      {/* NAV */}
      <header className="nav">
        <div className="wrap navrow">
          <div className="brand">
            <img src="/k2-logo.png" alt="K2 Investment" />
            <span>K2 <b>Investment</b></span>
          </div>
          <nav className="navlinks">
            <a href="#how">How it works</a>
            <a href="#abilities">What it does</a>
            <Link className="btn btn-sm" href="/tool">Launch the app →</Link>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow">LAND DUE-DILIGENCE · AUTOMATED · STATEWIDE CALIFORNIA</div>
            <h1>Know everything on record<br/><em>before</em> you buy the land.</h1>
            <p className="lead">Type an address anywhere in California. In under two minutes K2 pulls the parcel record, cross-references live flood and fire maps, reads the zoning on file, and hands you one report — every public fact about the property, in front of you before you commit.</p>
            <div className="cta-row">
              <Link className="btn btn-lg" href="/tool">Analyze a property →</Link>
              <a className="btn btn-ghost btn-lg" href="#how">See how it works</a>
            </div>
            <div className="trust">Built by K2 Investment Inc. · 30 years in California real estate</div>
          </div>
          <div className="hero-card">
            <div className="hc-head">
              <span className="hc-dot" /> <b>20 Longhorn Ridge Rd</b> · Napa
            </div>
            <div className="hc-row"><span>Zoning</span><b>AW — Agricultural Watershed</b></div>
            <div className="hc-row"><span>Density on record</span><b className="accent">1 dwelling + ADU</b></div>
            <div className="hc-row"><span>Flood (FEMA)</span><b className="ok">Zone X · minimal</b></div>
            <div className="hc-row"><span>Fire hazard</span><b className="warn">Very High</b></div>
            <div className="hc-analysis">"A single-estate or agricultural hold — upside is scenic value and ADU income, not density. Fire rating is the main carrying-cost risk…"</div>
            <div className="hc-foot">Investor Analysis · auto-generated</div>
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="strip">
        <div className="wrap strip-grid">
          <div><div className="big">3–5 days</div><p>digging through county sites & 100-page zoning PDFs</p></div>
          <div><div className="big">$5,000+</div><p>in consultant fees per parcel for the same answers</p></div>
          <div className="arrow">→</div>
          <div className="hl"><div className="big accent">&lt; 2 min</div><p>one address, one report, with K2</p></div>
        </div>
      </section>

      {/* ABILITIES */}
      <section id="abilities" className="section">
        <div className="wrap">
          <h2 className="center">One report answers the three questions that decide a land deal</h2>
          <div className="cards">
            <div className="card">
              <div className="cn">01</div>
              <h3>What the record shows</h3>
              <p>The parcel's zoning district and allowed uses, minimum lot size and density, the maximum dwellings by right, ADU potential, and the buildable envelope — pulled live and read against the county code.</p>
            </div>
            <div className="card">
              <div className="cn">02</div>
              <h3>What could stop the deal</h3>
              <p>Live checks against FEMA flood zones, CAL FIRE hazard severity, Williamson Act contracts, and terrain — the constraints that quietly kill a project, surfaced as clear green / amber / red flags.</p>
            </div>
            <div className="card">
              <div className="cn">03</div>
              <h3>Whether it's worth it</h3>
              <p>Land use, assessed value, development capacity, and a written <b>investor analysis</b> that weighs the upside against the risks and gives you a straight bottom-line take on the parcel.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="section alt">
        <div className="wrap feat-grid">
          <div className="feat">
            <div className="ficon">◆</div>
            <h4>AI investor analysis</h4>
            <p>Every report opens with a written take that reads the lot like an investor would — development angle, deal-killers, and a verdict.</p>
          </div>
          <div className="feat">
            <div className="ficon">◎</div>
            <h4>Statewide California</h4>
            <p>Any address in the state. Parcel boundaries, zoning, and hazards normalized into one clean answer, county by county.</p>
          </div>
          <div className="feat">
            <div className="ficon">▤</div>
            <h4>Investor-grade PDF</h4>
            <p>One tap exports a branded, downloadable report — the property outline, the three sections, and the analysis — ready to send.</p>
          </div>
        </div>
      </section>

      {/* HOW */}
      <section id="how" className="section">
        <div className="wrap">
          <h2 className="center">From address to answer in three steps</h2>
          <div className="steps">
            <div className="step"><span>1</span><div><b>Enter a property</b><p>Type any California address or APN, or drop a pin on the map.</p></div></div>
            <div className="step"><span>2</span><div><b>K2 does the digging</b><p>It finds the exact parcel, queries FEMA and county hazard layers, and reads the zoning — automatically.</p></div></div>
            <div className="step"><span>3</span><div><b>Get the report</b><p>A clear on-screen readout and a downloadable investor PDF — in under two minutes.</p></div></div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta">
        <div className="wrap center">
          <h2 style={{color:"#fff",marginBottom:14}}>Type an address. Get the report.</h2>
          <p style={{color:"#cfe0f2",maxWidth:560,margin:"0 auto 26px"}}>Replace days of consultants and guesswork with a two-minute feasibility screen for any parcel in California.</p>
          <Link className="btn btn-lg btn-white" href="/tool">Analyze a property →</Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="foot">
        <div className="wrap footrow">
          <div className="brand small">
            <img src="/k2-logo.png" alt="K2" />
            <span>K2 <b>Investment</b> Inc.</span>
          </div>
          <div className="fnote">Downtown Los Angeles · Serving California real estate for 30 years. The Parcel Finder is a rapid feasibility screen for informational purposes only — not legal, financial, investment, or land-use advice, and not an appraisal. Reports draw on public data and AI analysis that may contain errors; verify everything with the applicable planning department and licensed professionals before any decision.</div>
        </div>
      </footer>
    </main>
  );
}

const CSS = `
:root{--ink:#43392f;--taupe:#6f6156;--blue:#2f74c0;--blue2:#1e5a9e;--sky:#eaf3fc;--cream:#faf8f4;--line:#ece6de;}
*{box-sizing:border-box;margin:0;padding:0}
main{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--ink);background:var(--cream);-webkit-font-smoothing:antialiased}
.wrap{max-width:1140px;margin:0 auto;padding:0 24px}
h1,h2,h3,h4{font-family:Georgia,"Times New Roman",serif;font-weight:700;letter-spacing:-.5px;color:var(--ink)}
a{color:inherit;text-decoration:none}
.btn{display:inline-block;background:var(--blue);color:#fff;font-weight:600;border-radius:10px;padding:11px 22px;transition:.15s;border:1px solid var(--blue)}
.btn:hover{background:var(--blue2);border-color:var(--blue2)}
.btn-sm{padding:8px 16px;font-size:14px}
.btn-lg{padding:14px 28px;font-size:16px}
.btn-ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.btn-ghost:hover{background:#fff;border-color:var(--taupe)}
.btn-white{background:#fff;color:var(--blue2);border-color:#fff}
.btn-white:hover{background:#eef4fb}
/* nav */
.nav{position:sticky;top:0;z-index:50;background:rgba(250,248,244,.9);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.navrow{display:flex;align-items:center;justify-content:space-between;height:66px}
.brand{display:flex;align-items:center;gap:10px;font-family:Georgia,serif;font-size:19px;color:var(--ink)}
.brand b{color:var(--blue)}
.brand img{height:34px;width:34px;object-fit:contain}
.brand.small{font-size:16px}.brand.small img{height:28px;width:28px}
.navlinks{display:flex;align-items:center;gap:26px;font-size:15px;color:var(--taupe)}
.navlinks a:hover{color:var(--ink)}
/* hero */
.hero{padding:70px 0 60px;background:radial-gradient(1200px 500px at 80% -10%,var(--sky),transparent 60%)}
.hero-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:54px;align-items:center}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:1.5px;color:var(--blue);margin-bottom:18px}
h1{font-size:52px;line-height:1.08}
h1 em{color:var(--blue);font-style:italic}
.lead{margin:22px 0 28px;font-size:18px;line-height:1.6;color:var(--taupe);max-width:560px}
.cta-row{display:flex;gap:14px;flex-wrap:wrap}
.trust{margin-top:22px;font-size:13px;color:#9a8d80}
/* hero card */
.hero-card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 30px 60px -30px rgba(67,57,47,.35)}
.hc-head{display:flex;align-items:center;gap:8px;font-size:15px;padding-bottom:14px;border-bottom:1px solid var(--line);margin-bottom:6px}
.hc-dot{width:9px;height:9px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px #dcfce7}
.hc-row{display:flex;justify-content:space-between;font-size:14px;padding:9px 0;border-bottom:1px solid #f5f1eb}
.hc-row span{color:var(--taupe)}
.accent{color:var(--blue)}.ok{color:#166534}.warn{color:#b45309}
.hc-analysis{margin-top:12px;font-size:13px;line-height:1.55;color:#5b5148;font-style:italic;background:var(--sky);padding:12px 14px;border-radius:10px}
.hc-foot{margin-top:8px;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:#a99c8e}
/* strip */
.strip{background:var(--ink);color:#efe9e2}
.strip-grid{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:34px 24px;flex-wrap:wrap}
.strip .big{font-family:Georgia,serif;font-size:30px;color:#fff}
.strip p{font-size:14px;color:#c7bcae;margin-top:4px;max-width:230px}
.strip .accent{color:#7db4ec}
.strip .arrow{font-size:28px;color:#8a7c6d}
.strip .hl .big{color:#7db4ec}
/* sections */
.section{padding:76px 0}
.section.alt{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.center{text-align:center}
h2{font-size:34px;line-height:1.2;max-width:760px;margin:0 auto}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:44px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:28px;transition:.15s}
.card:hover{transform:translateY(-3px);box-shadow:0 18px 40px -24px rgba(67,57,47,.4)}
.cn{font-family:Georgia,serif;font-size:15px;color:var(--blue);font-weight:700;margin-bottom:10px}
.card h3{font-size:21px;margin-bottom:10px}
.card p{font-size:15px;line-height:1.6;color:var(--taupe)}
.feat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:36px}
.ficon{width:46px;height:46px;border-radius:12px;background:var(--sky);color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:14px}
.feat h4{font-size:18px;margin-bottom:8px}
.feat p{font-size:14.5px;line-height:1.6;color:var(--taupe)}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:44px}
.step{display:flex;gap:16px;align-items:flex-start}
.step span{flex:none;width:38px;height:38px;border-radius:50%;background:var(--blue);color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:Georgia,serif}
.step b{display:block;font-size:17px;margin-bottom:4px}
.step p{font-size:14.5px;line-height:1.55;color:var(--taupe)}
/* cta */
.cta{background:linear-gradient(135deg,var(--blue2),#16406f);padding:74px 0}
/* footer */
.foot{background:var(--ink);color:#cdbfb0;padding:36px 0}
.footrow{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.foot .brand{color:#fff}.foot .brand b{color:#7db4ec}
.fnote{font-size:12.5px;color:#a4998b;max-width:560px;line-height:1.5}
@media(max-width:860px){
  .hero-grid{grid-template-columns:1fr;gap:36px}
  h1{font-size:38px}h2{font-size:27px}
  .cards,.feat-grid,.steps{grid-template-columns:1fr}
  .navlinks a:not(.btn){display:none}
  .strip .arrow{display:none}
}
`;
