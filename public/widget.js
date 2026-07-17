/* K2 Investment Parcel Finder — embeddable widget loader
   Usage (inline):
     <div id="k2-parcel-finder"></div>
     <script src="https://parcels.k2investments.com/widget.js"
             data-key="YOUR_KEY" data-brand="Your Brokerage" data-height="740"></script>
   Usage (floating button + modal):
     <script src="https://parcels.k2investments.com/widget.js"
             data-key="YOUR_KEY" data-mode="button"></script>
*/
(function () {
  var s = document.currentScript;
  if (!s) { var all = document.getElementsByTagName("script"); s = all[all.length - 1]; }
  var base = new URL(s.src).origin;
  var key = s.getAttribute("data-key") || "";
  var brand = s.getAttribute("data-brand") || "";
  var height = s.getAttribute("data-height") || "740";
  var mode = s.getAttribute("data-mode") || "inline";
  var url = base + "/tool?embed=1" +
    (key ? "&key=" + encodeURIComponent(key) : "") +
    (brand ? "&brand=" + encodeURIComponent(brand) : "");

  function iframe(h) {
    var f = document.createElement("iframe");
    f.src = url;
    f.title = "K2 Investment Parcel Finder";
    f.setAttribute("loading", "lazy");
    f.setAttribute("allow", "clipboard-write; geolocation");
    f.style.cssText = "width:100%;height:" + h + "px;border:0;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.12);display:block";
    return f;
  }

  if (mode === "button") {
    var btn = document.createElement("button");
    btn.textContent = "Check land feasibility";
    btn.style.cssText = "position:fixed;bottom:22px;right:22px;z-index:99998;background:#2563eb;color:#fff;border:0;border-radius:999px;padding:14px 22px;font:600 15px/1 system-ui,sans-serif;box-shadow:0 8px 24px rgba(37,99,235,.4);cursor:pointer";

    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.62);display:none;align-items:center;justify-content:center;padding:16px";

    var box = document.createElement("div");
    box.style.cssText = "position:relative;width:100%;max-width:1040px;height:90vh;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4)";

    var close = document.createElement("button");
    close.textContent = "\u2715";
    close.style.cssText = "position:absolute;top:10px;right:10px;z-index:2;background:#fff;border:0;border-radius:50%;width:36px;height:36px;font-size:16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)";

    var f = iframe(9999); f.style.height = "100%"; f.style.borderRadius = "0";
    box.appendChild(close); box.appendChild(f); overlay.appendChild(box);

    btn.addEventListener("click", function () { overlay.style.display = "flex"; });
    close.addEventListener("click", function () { overlay.style.display = "none"; });
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.style.display = "none"; });

    document.body.appendChild(btn);
    document.body.appendChild(overlay);
  } else {
    var target = document.getElementById("k2-parcel-finder");
    var el = iframe(height);
    if (target) target.appendChild(el);
    else if (s.parentNode) s.parentNode.insertBefore(el, s.nextSibling);
  }
})();
