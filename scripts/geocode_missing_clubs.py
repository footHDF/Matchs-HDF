import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MISSING = ROOT / "data" / "missing_clubs.json"
CLUBS = ROOT / "data" / "club_locations.json"

NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "Matchs-HDF (github) - contact: actions@users.noreply.github.com"

def norm_name(s: str) -> str:
    # normalisation légère et stable (tu peux renforcer plus tard)
    return " ".join((s or "").strip().upper().split())

def nominatim_search(query: str):
    params = {
        "q": query,
        "format": "json",
        "limit": 1,
        "addressdetails": 1,
        "countrycodes": "fr",
    }
    url = NOMINATIM + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data[0] if data else None

def main():
    missing = json.loads(MISSING.read_text(encoding="utf-8")) if MISSING.exists() else []
    clubs = json.loads(CLUBS.read_text(encoding="utf-8")) if CLUBS.exists() else {}

    # index normalisé -> clé originale
    existing_norm = {norm_name(k): k for k in clubs.keys()}

    updated = False
    still_missing = []

    for raw in missing:
        key = norm_name(raw)
        if key in existing_norm:
            continue

        # requête géocodage : club + région
        q = f"{raw}, Hauts-de-France, France"
        try:
            hit = nominatim_search(q)
        except Exception as e:
            still_missing.append(raw)
            continue

        if not hit:
            still_missing.append(raw)
        else:
            lat = float(hit["lat"])
            lon = float(hit["lon"])
            city = (hit.get("address", {}) or {}).get("city") \
                or (hit.get("address", {}) or {}).get("town") \
                or (hit.get("address", {}) or {}).get("village") \
                or ""

            clubs[raw] = {"city": city, "lat": lat, "lon": lon}
            updated = True

        # respect 1 req/sec
        time.sleep(1.1)

    if updated:
        CLUBS.write_text(json.dumps(clubs, ensure_ascii=False, indent=2), encoding="utf-8")

    # on réécrit ce qui reste à traiter
    MISSING.write_text(json.dumps(still_missing, ensure_ascii=False, indent=2), encoding="utf-8")

if __name__ == "__main__":
    main()
