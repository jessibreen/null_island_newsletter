(function () {
  "use strict";

  const P = {
    sea: "#c9dcdd", coast: "#6f8f7c", stateLine: "#ffffff",
    biome: { "Tropical Rainforest": "#C2E699", "Tropical Seasonal Forest": "#78C679", "Savanna": "#FFFFCC", "Wetland": "#238443" },
    lake: "#b4d0d6", river: "#86b3bf", trail: "#6b4a28", road: "#3b3b3b",
    city: "#002673", cityRing: "#ffffff",
    palmopectis: "#2f6b3a", lianus: "#c9950f", fructumbra: "#8e2f4a", ghostpine: "#5f6f68",
    potential: "#FF5500", hp: "#FF73DF", hpLine: "#7a4d00",
    cam: "#E00b32", camBuf: "#ffffff", cityBuf: "#3a2a7a",
    proposed: "#e2a93b", site: "#00ffff", siteTrail: "#6b4a28"
  };

  // Each story section's data-view names one of these entries. `layers` lists
  // the overlays to build below; `fit`, `fade`, `site`, and `towns` adjust them.
  const VIEWS = {
    overview: { title: "Null Island", layers: ["trails", "cities"], fit: "island",
      legend: ["biomes", ["line", "trail", "Trails", "dash"], ["dot", "city", "Cities"]] },
    hpByCity: { title: "Cities with the most High Priority habitat within 10 km", layers: ["hpByCity", "cityBuffers", "topCities"], fit: "island", fade: false,
      legend: [["ring", "cityBuf", "10 km city buffer"], ["fill", "hp", "High Priority habitat"], ["dot", "city", "Selected city"]] },
    potential: { title: "Step 2: Potential habitat patches", layers: ["potential"], fit: "island", fade: false,
      legend: [["fill", "potential", "Potential habitat"]] },
    cams: { title: "Step 3: Active trail cameras", layers: ["potentialFaint", "trailcams"], fit: "island", fade: false,
      legend: [["dot", "cam", "Trail camera, Mar–May"], ["fill", "potential", "Potential habitat"]] },
    highpriority: { title: "Step 4: High Priority habitat patches", layers: ["highpriority"], fit: "island", fade: false,
      legend: [["fill", "hp", "High Priority habitat"]] },
    siteA: { title: "Site A, near Hornley", site: "Site A", towns: ["Hornley"], layers: ["trails", "proposed", "sites", "siteTrails", "cities"], fit: "site",
      legend: [["line", "site", "Site A boundary"], ["fill", "proposed", "Potential reserve patch"], ["line", "siteTrail", "Trail inside the site"]] },
    siteB: { title: "Site B, between Wigford and Sealewich", site: "Site B", towns: ["Wigford", "Sealewich"], layers: ["trails", "proposed", "sites", "siteTrails", "cities"], fit: "site",
      legend: [["line", "site", "Site B boundary"], ["fill", "proposed", "Potential reserve patch"], ["line", "siteTrail", "Trail inside the site"]] },
    siteC: { title: "Site C, near Maringra", site: "Site C", towns: ["Maringra"], layers: ["trails", "proposed", "sites", "siteTrails", "cities"], fit: "site",
      legend: [["line", "site", "Site C boundary"], ["fill", "proposed", "Potential reserve patch"], ["line", "siteTrail", "Trail inside the site"]] }
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = n => Number(n).toLocaleString("en-US");

  // D is the parsed data/null-island.json object. Its top-level keys are the
  // GeoJSON layer names used throughout this script (for example D.biomes).
  let D = null, map = null, insetMap = null, currentView = null, dynamic = null, base = null, islandBounds = null;

  /* ---------- Map ---------- */
  function polyStyle(fill, opts) {
    return Object.assign({ color: fill, weight: 0.6, fillColor: fill, fillOpacity: 0.55, opacity: 0.9 }, opts || {});
  }
  function popupRows(title, rows) {
    return "<b>" + title + "</b>" + rows.map(r => "<br>" + r).join("");
  }
  function label(latlng, text, cls) {
    return L.tooltip({ permanent: true, direction: "right", offset: [6, 0], className: "lbl " + (cls || ""), interactive: false })
      .setLatLng(latlng).setContent(text);
  }
  function centroid(feature) {
    return L.geoJSON(feature).getBounds().getCenter();
  }

  function buildBase() {
    if (base) base.remove();
    // These layers stay underneath every story view: biomes, state boundaries,
    // lakes, rivers, and the state/coast outline, all styled from the active palette.
    base = L.layerGroup([
      L.geoJSON(D.biomes, {
        style: f => ({ color: P.biome[f.properties.biome] || "#9ab", weight: 0, fillColor: P.biome[f.properties.biome] || "#9ab", fillOpacity: 1 }),
        onEachFeature: (f, l) => l.bindPopup(popupRows(f.properties.biome, ["Biome"]))
      }),
      L.geoJSON(D.states, { style: { color: P.stateLine, weight: 0.8, opacity: 0.7, fill: false, dashArray: "3 3" }, interactive: false }),
      L.geoJSON(D.lakes, { style: { color: P.lake, weight: 0, fillColor: P.lake, fillOpacity: 1 }, interactive: false }),
      L.geoJSON(D.rivers, { style: { color: P.river, weight: 0.8, opacity: 0.9 }, interactive: false }),
      L.geoJSON(D.states, { style: { color: P.coast, weight: 1.1, opacity: 0.8, fill: false }, interactive: false })
    ]).addTo(map);
    base.eachLayer(l => l.bringToBack && l.bringToBack());
  }

  function make(name, view) {
    // Layer names come from VIEWS[].layers. Most cases draw the matching JSON
    // collection directly; the buffer and selected-city cases derive circles/markers.
    switch (name) {
      case "trails":
        return L.geoJSON(D.trails, { style: { color: P.trail, weight: 1.2, opacity: 0.8, dashArray: "4 3" }, interactive: false });
      case "roads":
        return L.geoJSON(D.roads, { style: { color: P.road, weight: 2.2, opacity: 0.85 }, interactive: false });
      case "cities": {
        const g = L.layerGroup();
        const towns = (view && view.towns) || [];
        // City points use properties.name, pop, and cap; coordinates are [lon, lat].
        D.cities.features.forEach(f => {
          const ll = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
          const m = L.circleMarker(ll, { radius: 2.8, color: P.cityRing, weight: 1, fillColor: P.city, fillOpacity: 1 })
            .bindPopup(popupRows(f.properties.name, ["Population " + fmt(f.properties.pop), f.properties.cap ? "State capital" : ""].filter(Boolean)));
          if (!towns.includes(f.properties.name)) m.bindTooltip(f.properties.name, { direction: "top", offset: [0, -4] });
          g.addLayer(m);
          if (towns.includes(f.properties.name)) g.addLayer(label(ll, f.properties.name));
        });
        return g;
      }
      case "palmopectis": case "lianus": case "fructumbra": case "ghostpine":
        // These keys are polygon ranges; the collection key also selects its palette color.
        return L.geoJSON(D[name], { style: polyStyle(P[name], { fillOpacity: name === "ghostpine" ? 0.7 : 0.42, weight: 1 }), interactive: false });
      case "trailcams":
        // Camera points use properties.id and m (month number: 3=March, 4=April, 5=May).
        return L.geoJSON(D.trailcams, {
          pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 2.6, color: P.cam, weight: 0, fillColor: P.cam, fillOpacity: 0.9 })
            .bindPopup(popupRows("Trail camera " + f.properties.id, ["Active in " + ["", "", "", "March", "April", "May"][f.properties.m]]))
        });
      case "camBuffers": {
        // Derived 3 km circles around every trail-camera point; not a separate JSON layer.
        const g = L.layerGroup();
        D.trailcams.features.forEach(f => g.addLayer(L.circle([f.geometry.coordinates[1], f.geometry.coordinates[0]],
          { radius: 3000, color: P.camBuf, weight: 1, opacity: 0.85, fillColor: P.camBuf, fillOpacity: 0.12, interactive: false })));
        return g;
      }
      case "potential":
        // Habitat polygons use properties.ha for popup area; potentialFaint reuses this data.
        return L.geoJSON(D.potential, { style: polyStyle(P.potential, { fillOpacity: 0.75, weight: 0.8 }),
          onEachFeature: (f, l) => l.bindPopup(popupRows("Potential habitat patch", [fmt(f.properties.ha) + " ha"])) });
      case "potentialFaint":
        return L.geoJSON(D.potential, { style: polyStyle(P.potential, { fillOpacity: 0.35, weight: 0 }), interactive: false });
      case "highpriority":
        // Precomputed subset of potential habitat, also carrying area in properties.ha.
        return L.geoJSON(D.highpriority, { style: polyStyle(P.hp, { color: P.hpLine, weight: 1, fillOpacity: 0.9 }),
          onEachFeature: (f, l) => l.bindPopup(popupRows("High Priority habitat", [fmt(f.properties.ha) + " ha"])) });
      case "hpByCity":
        // Precomputed high-priority patches by nearby city; properties.city and ha drive popups.
        return L.geoJSON(D.hpByCity, { style: polyStyle(P.hp, { color: P.hpLine, weight: 0.8, fillOpacity: 0.9 }),
          onEachFeature: (f, l) => l.bindPopup(popupRows(f.properties.city, [fmt(f.properties.ha) + " ha of High Priority habitat within 10 km"])) });
      case "cityBuffers": {
        // Derived 10 km circles around the preselected points in D.topCities.
        const g = L.layerGroup();
        D.topCities.features.forEach(f => g.addLayer(L.circle([f.geometry.coordinates[1], f.geometry.coordinates[0]],
          { radius: 10000, color: P.cityBuf, weight: 2, opacity: 0.9, fillColor: P.cityBuf, fillOpacity: 0.08, interactive: false })));
        return g;
      }
      case "topCities": {
        // Selected city points use the same name/pop fields as D.cities, with label offsets by name.
        const g = L.layerGroup();
        D.topCities.features.forEach(f => {
          const ll = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
          g.addLayer(L.circleMarker(ll, { radius: 4.5, color: P.cityRing, weight: 1.2, fillColor: P.city, fillOpacity: 1 })
            .bindPopup(popupRows(f.properties.name, ["Population " + fmt(f.properties.pop)])));
          const dir = { Betrinch: ["right", [12, 8]], Tindoreham: ["top", [0, -8]], Tetrinch: ["left", [-8, 0]], Axbridgeton: ["right", [8, 0]] }[f.properties.name] || ["right", [6, 0]];
          g.addLayer(L.tooltip({ permanent: true, direction: dir[0], offset: dir[1], className: "lbl", interactive: false })
            .setLatLng(ll).setContent(f.properties.name));
        });
        return g;
      }
      case "proposed":
        // Candidate reserve polygons; properties.ha is shown in each popup.
        return L.geoJSON(D.proposed, { style: polyStyle(P.proposed, { color: P.proposed, weight: 1, fillOpacity: 0.8 }),
          onEachFeature: (f, l) => l.bindPopup(popupRows("Potential reserve patch", [fmt(f.properties.ha) + " ha"])) });
      case "sites":
        // Sanctuary polygons use properties.name and ha; view.site controls emphasis and label.
        return L.geoJSON(D.sites, {
          style: f => ({ color: P.site, weight: view && view.site && view.site !== f.properties.name ? 1.5 : 3, fill: true, fillColor: P.site, fillOpacity: 0.08 }),
          onEachFeature: (f, l) => {
            l.bindPopup(popupRows(f.properties.name, [fmt(f.properties.ha) + " ha proposed sanctuary"]));
            if (view && view.site === f.properties.name) {
              l.bindTooltip(f.properties.name, { permanent: true, direction: "center", className: "lbl site" });
            }
          }
        });
      case "siteLabels": {
        const g = L.layerGroup();
        D.sites.features.forEach(f => g.addLayer(label(centroid(f), f.properties.name, "site")));
        return g;
      }
      case "siteTrails":
        // Trail segments within the candidate sites; properties.m is segment length in metres.
        return L.geoJSON(D.siteTrails, { style: { color: P.siteTrail, weight: 3, opacity: 0.95 },
          onEachFeature: (f, l) => l.bindPopup(popupRows("Trail", [fmt(f.properties.m) + " m"])) });
    }
    return null;
  }

  function boundsFor(view) {
    if (view.fit === "topCities") return L.geoJSON(D.topCities).getBounds().pad(0.18);
    if (view.fit === "sites") return L.geoJSON(D.sites).getBounds().pad(0.25);
    if (view.fit === "site") {
      const f = D.sites.features.find(x => x.properties.name === view.site);
      return L.geoJSON(f).getBounds().pad(0.9);
    }
    return islandBounds;
  }

  function renderLegend(view) {
    const el = document.getElementById("legend");
    const rows = [];
    view.legend.forEach(item => {
      if (item === "biomes") {
        Object.keys(P.biome).forEach(b => rows.push('<div><span class="sw" style="background:' + P.biome[b] + '"></span>' + b + "</div>"));
        return;
      }
      const [kind, key, text, variant] = item;
      const c = P[key];
      let sw;
      if (kind === "fill") sw = '<span class="sw" style="background:' + c + '"></span>';
      else if (kind === "dot") sw = '<span class="sw dot" style="background:' + c + '"></span>';
      else if (kind === "ring") sw = '<span class="sw ring" style="border-color:' + c + '"></span>';
      else sw = '<span class="sw ' + (variant === "dash" ? "dash" : "line") + '" style="border-top-color:' + c + '"></span>';
      rows.push("<div>" + sw + text + "</div>");
    });
    el.innerHTML = rows.join("");
  }

  function setView(key, force) {
    if (!map || (!force && key === currentView)) return;
    currentView = key;
    const view = VIEWS[key];
    const globalInset = document.getElementById("globalInset");
    globalInset.hidden = key !== "overview";
    if (!globalInset.hidden && insetMap) requestAnimationFrame(() => insetMap.invalidateSize());
    if (dynamic) dynamic.remove();
    dynamic = L.layerGroup();
    // Rebuild only this view's overlays; the shared base layers remain in place.
    view.layers.forEach(n => { const l = make(n, view); if (l) dynamic.addLayer(l); });
    dynamic.addTo(map);
    // soften the biome colours when thematic layers need to stand out
    base.eachLayer(l => { if (l.setStyle && l.getLayers && l.getLayers()[0] && l.getLayers()[0].feature && l.getLayers()[0].feature.properties.biome) l.setStyle({ fillOpacity: view.fade ? 0.55 : 1 }); });
    document.getElementById("mapTitle").textContent = view.title;
    renderLegend(view);
    const b = boundsFor(view);
    if (force || reduceMotion) map.fitBounds(b, { animate: false });
    else map.flyToBounds(b, { duration: 1.1 });
  }

  function initMap() {
    map = L.map("map", { zoomControl: true, scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 6, maxZoom: 14, attributionControl: true });
    map.zoomControl.setPosition("topright");
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    map.attributionControl.addAttribution("Null Island Data Layers · Analysis: A. Kilguss");
    L.control.scale({ metric: true, imperial: false, position: "bottomright" }).addTo(map);
    islandBounds = L.geoJSON(D.states).getBounds().pad(0.04);
    insetMap = L.map("insetMap", {
      zoomControl: false, scrollWheelZoom: false, doubleClickZoom: false,
      boxZoom: false, keyboard: false, dragging: false, touchZoom: false
    }).setView([0, 0], 2);
    insetMap.attributionControl.setPrefix(false);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(insetMap);
    L.geoJSON(D.states, {
      style: { color: P.site, weight: 1, fillColor: P.site, fillOpacity: 0.3 },
      interactive: false
    }).addTo(insetMap);
    L.circleMarker(islandBounds.getCenter(), {
      radius: 5, color: P.cityRing, weight: 1.5, fillColor: P.site, fillOpacity: 1, interactive: false
    }).addTo(insetMap);
    map.fitBounds(islandBounds, { animate: false });
    map.setMaxBounds(islandBounds.pad(1.5));
    map.getContainer().style.background = P.sea;
    buildBase();
    setView("overview", true);
    window.addEventListener("resize", () => { map.invalidateSize(); });
  }

  /* ---------- Scroll tracking ---------- */
  function initScroll() {
    const steps = Array.from(document.querySelectorAll(".step[data-view]"));
    const navLinks = Array.from(document.querySelectorAll(".sectionnav a"));
    let active = null;
    function activate(step) {
      if (step === active) return;
      if (active) active.classList.remove("is-active");
      active = step; step.classList.add("is-active");
      setView(step.dataset.view);
      const navKey = step.dataset.nav;
      navLinks.forEach(a => {
        const on = a.getAttribute("href") === "#" + navKey;
        a.setAttribute("aria-current", on ? "true" : "false");
        if (on && a.scrollIntoView && window.innerWidth <= 860) {
          const ol = a.closest("ol");
          ol.scrollTo({ left: a.offsetLeft - 16, behavior: reduceMotion ? "auto" : "smooth" });
        }
      });
    }
    function updateActiveStep() {
      const triggerY = window.innerHeight * 0.42;
      let selected = steps[0];
      steps.forEach(step => {
        if (step.getBoundingClientRect().top <= triggerY) selected = step;
      });
      activate(selected);
    }

    let scrollPending = false;
    window.addEventListener("scroll", () => {
      if (scrollPending) return;
      scrollPending = true;
      window.requestAnimationFrame(() => {
        scrollPending = false;
        updateActiveStep();
      });
    }, { passive: true });
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(updateActiveStep, 100);
    });
    updateActiveStep();
  }

  /* ---------- Boot ---------- */
  function showError(msg) {
    const d = document.createElement("div");
    d.className = "maperror"; d.textContent = msg;
    document.querySelector(".mapframe").appendChild(d);
  }

  if (typeof L === "undefined") {
    showError("The map library could not load. Check your internet connection and reload the page.");
    return;
  }

  // Keep this path in sync with the data file location; D is populated before
  // either map is initialized, so all named collections are available to renderers.
  fetch("data/null-island.json")
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(json => {
      D = json;
      initMap();
      initScroll();
    })
    .catch(() => showError("The map data could not load. If you opened index.html straight from your computer, view it through GitHub Pages or a local web server instead."));
})();

