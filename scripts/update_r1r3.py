import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
SOURCES_PATH = ROOT / "scripts" / "sources_r1r3.json"
CLUBS_PATH = ROOT / "data" / "club_locations.json"

OUT_MATCHES = ROOT / "data" / "matches.json"
OUT_MISSING = ROOT / "data" / "missing_clubs.json"
OUT_LAST = ROOT / "data" / "last_update.json"
OUT_DEBUG = ROOT / "data" / "debug_home_clubs.json"

BASE = "https://api-dofa.fff.fr"

UA = "Matchs-HDF (GitHub Actions) contact: actions@users.noreply.github.com"
HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json",
}

def norm(s: str) -> str:
    s = (s or "").upper().strip()
    s = s.replace("Œ", "OE").replace("Æ", "AE")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    s = re.sub(r"[’'\.\-_/]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s.replace(" ", "")

def get_json(url: str):
    r = requests.get(url, headers=HEADERS, timeout=45)
    r.raise_for_status()
    return r.json()

def iter_any_members(obj):
    """
    Rend une liste d'objets "membres" depuis des réponses API de formes variées:
    - {"hydra:member":[...]}
    - {"member":[...]}
    - [{"...":...}, ...]
    - {"items":[...]}
    """
    if obj is None:
        return []
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        for k in ("hydra:member", "member", "items", "matches", "results"):
            v = obj.get(k)
            if isinstance(v, list):
                return v
        # sinon, si c'est un dict “single object”
        return [obj]
    return []

def find_first(d: dict, keys: list[str]):
    for k in keys:
        if k in d and d[k] not in (None, "", []):
            return d[k]
    return None

def parse_match(m: dict, comp_code: str, source_url: str):
    """
    Essaie d'extraire un match depuis des structures possibles.
    On cherche:
    - date/heure
    - home/away
    """
    if not isinstance(m, dict):
        return None

    kickoff = find_first(m, ["date", "datetime", "kickoff", "match_date", "start_date"])
    if isinstance(kickoff, str):
        # Normalisation légère: si pas d'offset, on force +01:00
        if "T" in kickoff and ("+" in kickoff or kickoff.endswith("Z")):
            iso = kickoff.replace("Z", "+00:00")
        elif "T" in kickoff:
            iso = kickoff + "+01:00"
        else:
            # date seule -> ignore
            return None
    else:
        return None

    # équipes
    home = None
    away = None

    # cas 1: champs directs
    home = find_first(m, ["home", "home_team", "equipe_dom", "team_home", "homeTeam"])
    away = find_first(m, ["away", "away_team", "equipe_ext", "team_away", "awayTeam"])

    # cas 2: structures imbriquées
    if not home and isinstance(m.get("home"), dict):
        home = find_first(m["home"], ["name", "libelle", "label"])
    if not away and isinstance(m.get("away"), dict):
        away = find_first(m["away"], ["name", "libelle", "label"])

    if not home and isinstance(m.get("home_team"), dict):
        home = find_first(m["home_team"], ["name", "libelle", "label"])
    if not away and isinstance(m.get("away_team"), dict):
        away = find_first(m["away_team"], ["name", "libelle", "label"])

    # cas 3: participants[]
    if (not home or not away) and isinstance(m.get("participants"), list):
        parts = m["participants"]
        if len(parts) >= 2:
            def pname(p):
                if isinstance(p, dict):
                    return find_first(p, ["name", "libelle", "label"])
                return None
            home = home or pname(parts[0])
            away = away or pname(parts[1])

    if not home or not away:
        return None

    return {
        "competition": comp_code,
        "competition_label": comp_code,
        "kickoff": iso,
        "home": str(home).strip(),
        "away": str(away).strip(),
        "source": "API-DOFA",
        "source_url": source_url
    }

def main():
    sources = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    clubs = json.loads(CLUBS_PATH.read_text(encoding="utf-8"))
    clubs_norm = {norm(k): v for k, v in clubs.items()}

    raw_matches = []

    for comp_code, comp_ids in sources.items():
        for comp_id in comp_ids:
            # 1) récupérer les poules
            poules_url = f"{BASE}/api/compets/{comp_id}/phases/1/poules.json?filter="
            poules_json = get_json(poules_url)
            poules = iter_any_members(poules_json)

            # poule number / stage_number / number
            poule_nos = []
            for p in poules:
                if not isinstance(p, dict):
                    continue
                no = find_first(p, ["number", "poule_no", "stage_number", "gp_no"])
                if isinstance(no, int):
                    poule_nos.append(no)
                elif isinstance(no, str) and no.isdigit():
                    poule_nos.append(int(no))

            poule_nos = sorted(set(poule_nos))
            if not poule_nos:
                print("WARN: aucune poule détectée pour", comp_id, comp_code)
                continue

            # 2) Pour chaque poule: résultat + calendrier (on concatène)
            for poule_no in poule_nos:
                for endpoint in ("resultat", "calendrier"):
                    url = f"{BASE}/api/compets/{comp_id}/phases/1/poules/{poule_no}/{endpoint}"
                    try:
                        data = get_json(url)
                    except Exception as e:
                        print("WARN:", url, "=>", e)
                        continue

                    members = iter_any_members(data)

                    # Si la réponse est une liste “verbeuse”, on essaie aussi des sous-listes
                    candidates = []
                    for x in members:
                        if isinstance(x, dict):
                            # parfois la liste de matchs est dans une clé
                            for k in ("matches", "matchs", "rencontres", "games"):
                                if isinstance(x.get(k), list):
                                    candidates.extend(x[k])
                            candidates.append(x)
                        else:
                            candidates.append(x)

                    for m in candidates:
                        parsed = parse_match(m, comp_code, url)
                        if parsed:
                            raw_matches.append(parsed)

    # dédoublonnage
    uniq = {}
    for m in raw_matches:
        key = (m["competition"], m["kickoff"], norm(m["home"]), norm(m["away"]))
        uniq[key] = m
    raw_matches = list(uniq.values())

    # debug: 30 clubs domicile
    debug = []
    seen = set()
    for m in sorted(raw_matches, key=lambda x: x["kickoff"]):
        k = norm(m["home"])
        if k not in seen:
            debug.append({"raw": m["home"], "norm": k})
            seen.add(k)
        if len(debug) >= 30:
            break
    OUT_DEBUG.write_text(json.dumps(debug, ensure_ascii=False, indent=2), encoding="utf-8")

    # enrichir avec coordonnées club domicile
    missing = set()
    enriched = []
    for m in raw_matches:
        hk = norm(m["home"])
        if hk not in clubs_norm:
            missing.add(m["home"])
            continue
        loc = clubs_norm[hk]
        m["venue"] = {
            "city": loc.get("city", ""),
            "lat": float(loc["lat"]),
            "lon": float(loc["lon"])
        }
        enriched.append(m)

    enriched.sort(key=lambda x: x["kickoff"])

    OUT_MATCHES.write_text(
        json.dumps({"season": "auto", "matches": enriched}, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    OUT_MISSING.write_text(json.dumps(sorted(missing), ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_LAST.write_text(json.dumps({"last_update": datetime.now().isoformat()}, ensure_ascii=False, indent=2), encoding="utf-8")

    print("DEBUG raw matches =", len(raw_matches))
    print("DEBUG enriched matches =", len(enriched))
    print("DEBUG missing clubs =", len(missing))

if __name__ == "__main__":
    main()
