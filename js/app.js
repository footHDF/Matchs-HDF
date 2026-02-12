const RADIUS_KM = 60;

const COMPETITIONS = [
  { code: "N2", label: "N2" },
  { code: "N3", label: "N3" },
  { code: "R1", label: "R1" },
  { code: "R2", label: "R2" },
  { code: "R3", label: "R3" },
  { code: "CDF", label: "Coupe de France" },
  { code: "COUPE_LFHF", label: "Coupes LFHF" }
];

let allMatches = [];
let geocodes = [];
let activeCompetitions = new Set(COMPETITIONS.map(c => c.code));
let map, markerLayer, markers = [];

const el = id => document.getElementById(id);
const setStatus = msg => el("status").textContent = msg;

function buildChips() {
  const wrap = el("chips");
  wrap.innerHTML = "";
  COMPETITIONS.forEach(c => {
    const b = document.createElement("button");
    b.className = activeCompetitions.has(c.code) ? "chip on" : "chip";
    b.textContent = c.label;
    b.onclick = () => {
      if (activeCompetitions.has(c.code))
        activeCompetitions.delete(c.code);
      else
        activeCompetitions.add(c.code);
      buildChips();
      runSearch();
    };
    wrap.appendChild(b);
  });
}

function initMap() {
  map = L.map("map").setView([50.2, 2.9], 8);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

function clearMarkers() {
  markerLayer.clearLayers();
  markers = [];
}

function addMarker(match, idx) {
  const m = L.marker([match.venue.lat, match.venue.lon]).addTo(markerLayer);
  m.bindPopup(`
    <b>${match.competition}</b><br>
    ${match.home} - ${match.away}<br>
    ${match.venue.city}
  `);
  markers.push(m);
}

function resolveQuery(q) {
  q = (q || "").toLowerCase().trim();
  return geocodes.find(g =>
    g.q.toLowerCase() === q ||
    g.label.toLowerCase().includes(q)
  );
}

function weekendFromKickoff(iso) {
  const d = new Date(iso);
  const day = d.getDay();
  const offset = (6 - day + 7) % 7;
  const sat = new Date(d);
  sat.setDate(d.getDate() + offset);
  sat.setHours(0,0,0,0);
  return sat.toISOString().slice(0,10);
}

function buildWeekendSelect() {
  const ids = [...new Set(allMatches.map(m => weekendFromKickoff(m.kickoff)))];
  const sel = el("weekendSelect");
  sel.innerHTML = "";
  ids.forEach(id=>{
    const o=document.createElement("option");
    o.value=id;
    o.textContent=id;
    sel.appendChild(o);
  });
}

function renderList(matches) {
  const list = el("list");
  list.innerHTML = "";
  matches.forEach(m=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`
      <div><b>${m.home}</b> vs <b>${m.away}</b></div>
      <div>${m.venue.city} — ${m.distance.toFixed(1)} km</div>
    `;
    list.appendChild(div);
  });
}

function runSearch() {
  const loc = resolveQuery(el("q").value);
  if (!loc) {
    setStatus("Entre une ville/CP HdF");
    return;
  }

  const weekend = el("weekendSelect").value;

  let matches = allMatches
    .filter(m => weekendFromKickoff(m.kickoff) === weekend)
    .filter(m => activeCompetitions.has(m.competition))
    .map(m => ({
      ...m,
      distance: haversineKm(
        loc.lat, loc.lon,
        m.venue.lat, m.venue.lon
      )
    }))
    .filter(m => m.distance <= RADIUS_KM);

  clearMarkers();
  matches.forEach(addMarker);
  renderList(matches);

  setStatus(matches.length + " match(s)");
}

async function loadData() {
  const m = await fetch("data/matches.json").then(r=>r.json());
  const g = await fetch("data/geocodes-hdf.json").then(r=>r.json());
  allMatches = m.matches;
  geocodes = g;
}

function bindUI() {
  el("q").addEventListener("input", runSearch);
  el("weekendSelect").addEventListener("change", runSearch);
}

(async function(){
  initMap();
  buildChips();
  await loadData();
  buildWeekendSelect();
  bindUI();
})();
