import json
import time
import urllib.parse
import urllib.request
import unicodedata
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MISSING = ROOT / "data" / "missing_clubs.json"
CLUBS = ROOT / "data" / "club_locations.json"

NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "Matchs-HDF (GitHub Actions) contact: actions@users.noreply.github.com"

def norm_key(s: str) -> str:
    s = (s or "").upper().strip()
    s = s.replace("Œ", "OE").replace("Æ", "AE")
    s = "".join(c for c in unicodedata.normalize("NFD", s)
                if unicodedata.category(c) != "Mn")
    s = re.sub(r"[’'\.\-_/]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def nominatim_search(q: str):
    params = {
        "q": q,
        "format": "json",
        "limit": 1,
        "addressdetails": 1,
        "countrycodes": "fr"
    }
    url = NOMINATIM + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=45) as resp:
        return json.loads(resp.read().decode("utf-8"))

def pick_city(addr: dict) -> str:
    return addr.get("city") or addr.get("town") or addr.get("village") or addr.get("municipality") or ""

def main():
    missing = json.loads(MISSING.read_text(encoding="utf-8")) if MISSING.exists() else []
    clubs = json.loads(CLUBS.read_text(encoding="utf-8")) if CLUBS.exists() else {}

    if not missing:
        print("No missing clubs.")
        return

    existing_norm = {norm_key(k): k for k in clubs.keys()}

    added = 0
    still_missing = []

    for club in missing:
        nk = norm_key(club)
        if nk in existing_norm:
            continue

        # requête : club + région pour éviter homonymes
        query = f"{club}, Hauts-de-France, France"
        try:
            results = nominatim_search(query)
        except Exception as e:
            print("ERROR:", club, e)
            still_missing.append(club)
            continue

        if not results:
            still_missing.append(club)
            print("NOT FOUND:", club)
        else:
            hit = results[0]
            lat = float(hit["lat"])
            lon = float(hit["lon"])
            addr = hit.get("address", {}) or {}
            city = pick_city(addr)

            clubs[club] = {"city": city, "lat": lat, "lon": lon}
            existing_norm[nk] = club
            added += 1
            print("ADDED:", club, "=>", city, lat, lon)

        # respect rate limit (≈1 req/sec)
        time.sleep(1.1)

        # sécurité : limite pour éviter trop de requêtes par run
        if added >= 80:
            print("Reached 80 additions in one run, stopping.")
            still_missing.extend([c for c in missing if norm_key(c) not in existing_norm])
            break

    CLUBS.write_text(json.dumps(clubs, ensure_ascii=False, indent=2), encoding="utf-8")
    MISSING.write_text(json.dumps(still_missing, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Done. Added:", added, "Still missing:", len(still_missing))

if __name__ == "__main__":
    main()

