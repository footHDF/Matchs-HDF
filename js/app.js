let map;

let CENTER = { lat: 49.848, lon: 3.287 };
let RADIUS_KM = 60;
let SELECTED_WEEKEND = null;
let ACTIVE_COMPETITIONS = new Set();
const COMP_ORDER = ["N2", "N3", "R1", "R2", "R3", "CDF", "COUPE_LFHF"];


// ---------- Chargement ----------
async function loadMatches() {
  const res = await fetch("data/matches.json");
  const json = await res.json();
  return json.matches;
}

async function loadGeocodes() {
  const res = await fetch("data/geocodes-hdf.json");
  return await res.json();
}

// ---------- Week-end ----------
function weekendIdFromKickoff(iso) {
  const d = new Date(iso);
  const day = d.getDay();
  const diff = (day === 0) ? -1 : (6 - day);
  const sat = new Date(d);
  sat.setDate(d.getDate() + diff);
  sat.setHours(0,0,0,0);
  return sat.toISOString().slice(0,10);
}

function labelWeekend(id) {
  const [y,m,d] = id.split("-").map(Number);
  const sat = new Date(y,m-1,d);
  const sun = new Date(y,m-1,d+1);
  const fmt = new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short"});
  return `${fmt.format(sat)}–${fmt.format(sun)} ${y}`;
}

// ---------- Carte ----------
function initMap() {
  map = L.map("map").setView([CENTER.lat,CENTER.lon],10);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    attribution:"© OpenStreetMap"
  }).addTo(map);
}

function clearMarkers(){
  map.eachLayer(l=>{
    if(l instanceof L.Marker) map.removeLayer(l);
  });
}

// ---------- Affichage ----------
function showMatches(matches){

  clearMarkers();
  const list=document.getElementById("list");
  list.innerHTML="";

  const processed = matches
    .filter(m=>!SELECTED_WEEKEND || weekendIdFromKickoff(m.kickoff)===SELECTED_WEEKEND)
    .filter(m=>ACTIVE_COMPETITIONS.size===0 || ACTIVE_COMPETITIONS.has(m.competition))
    .map(m=>{
      const d=haversineKm(CENTER.lat,CENTER.lon,m.venue.lat,m.venue.lon);
      return {m,d};
    })
    .filter(o=>o.d<=RADIUS_KM)
    .sort((a,b)=>a.d-b.d);

  processed.forEach(o=>{
    const m=o.m;
    const d=o.d;

    L.marker([m.venue.lat,m.venue.lon])
      .addTo(map)
      .bindPopup(`<b>${m.home} vs ${m.away}</b><br>${m.competition}<br>${d.toFixed(1)} km`);

    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`
      <b>${m.home}</b> vs <b>${m.away}</b><br>
      ${m.competition}<br>
      ${m.venue.city}<br>
      Distance : <b>${d.toFixed(1)} km</b>
    `;
    list.appendChild(div);
  });
}

// ---------- UI ----------
function bindSearch(geocodes,matches){
  document.getElementById("q").addEventListener("input",e=>{
    const q=e.target.value.toLowerCase();
    const f=geocodes.find(g=>g.q.toLowerCase()===q||g.label.toLowerCase().includes(q));
    if(!f) return;
    CENTER={lat:f.lat,lon:f.lon};
    map.setView([CENTER.lat,CENTER.lon],10);
    showMatches(matches);
  });
}

function bindRadius(matches){
  const s=document.getElementById("radius");
  const l=document.getElementById("radiusValue");
  RADIUS_KM=Number(s.value);
  l.textContent=s.value;
  s.addEventListener("input",()=>{
    RADIUS_KM=Number(s.value);
    l.textContent=s.value;
    showMatches(matches);
  });
}

function buildWeekendSelect(matches){
  const sel=document.getElementById("weekend");
  const ids=[...new Set(matches.map(m=>weekendIdFromKickoff(m.kickoff)))].sort();
  ids.forEach(id=>{
    const o=document.createElement("option");
    o.value=id;
    o.textContent=labelWeekend(id);
    sel.appendChild(o);
  });
  SELECTED_WEEKEND=ids[0];
}

function bindWeekend(matches){
  document.getElementById("weekend").addEventListener("change",e=>{
    SELECTED_WEEKEND=e.target.value;
    showMatches(matches);
  });
}

function buildCompetitionChips(matches){
  const wrap = document.getElementById("competitions");
  wrap.innerHTML = "";

  // Compétitions réellement présentes dans les données
  const present = new Set(matches.map(m => m.competition));

  COMP_ORDER.forEach(c => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = c;

    // Si la compétition n'existe pas dans le JSON, on l'affiche grisée (désactivée)
    if (!present.has(c)) {
      b.classList.add("disabled");
      b.disabled = true;
      wrap.appendChild(b);
      return;
    }

    // Si elle existe, bouton cliquable
    b.onclick = () => {
      if (ACTIVE_COMPETITIONS.has(c)) {
        ACTIVE_COMPETITIONS.delete(c);
        b.classList.remove("on");
      } else {
        ACTIVE_COMPETITIONS.add(c);
        b.classList.add("on");
      }
      showMatches(matches);
    };

    wrap.appendChild(b);
  });
}


// ---------- Start ----------
async function start(){
  initMap();
  const matches=await loadMatches();
  const geocodes=await loadGeocodes();

  buildWeekendSelect(matches);
  buildCompetitionChips(matches);

  showMatches(matches);

  bindSearch(geocodes,matches);
  bindRadius(matches);
  bindWeekend(matches);
}

document.addEventListener("DOMContentLoaded",start);
