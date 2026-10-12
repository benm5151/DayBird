#!/usr/bin/env python3
"""Build the Daybird morning brief: data/brief.json + data/brief.txt.
Runs in GitHub Actions (see .github/workflows/brief.yml). Needs EBIRD_KEY in the environment.
Same scoring rules as js/app.js makeCall()."""
import json, os, sys, urllib.request, urllib.parse, datetime, zoneinfo, collections

LAT, LNG, DIST, BACK = 43.6423, -72.2518, 25, 3
TZ = zoneinfo.ZoneInfo("America/New_York")
KEY = os.environ.get("EBIRD_KEY", "").strip()
SITE = "https://benm5151.github.io/DayBird/"

def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

now = datetime.datetime.now(TZ)
errors = []

# ---- weather: 06:00–09:00 local today ----
wx = None
try:
    w = get(f"https://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LNG}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m&daily=sunrise&timezone=America%2FNew_York&forecast_days=1&wind_speed_unit=mph&temperature_unit=fahrenheit")
    idx = [i for i, t in enumerate(w["hourly"]["time"]) if t[11:13] in ("06", "07", "08", "09")][:4]
    avg = lambda k: sum(w["hourly"][k][i] for i in idx) / len(idx)
    wx = {"temp": round(avg("temperature_2m")), "wind": round(avg("wind_speed_10m")), "windDir": round(avg("wind_direction_10m")),
          "rain": round(avg("precipitation_probability")), "sunrise": w["daily"]["sunrise"][0][11:16]}
except Exception as e:
    errors.append(f"weather: {e}")

# ---- eBird ----
notable, spots = [], []
if KEY:
    H = {"X-eBirdApiToken": KEY}
    try:
        notable = get(f"https://api.ebird.org/v2/data/obs/geo/recent/notable?lat={LAT}&lng={LNG}&dist={DIST}&back={BACK}&detail=simple", H)[:8]
    except Exception as e:
        errors.append(f"ebird notable: {e}")
    try:
        recent = get(f"https://api.ebird.org/v2/data/obs/geo/recent?lat={LAT}&lng={LNG}&dist={DIST}&back={BACK}", H)
        by = {}
        for o in recent:
            k = o.get("locId") or o["locName"]
            by.setdefault(k, {"name": o["locName"], "locId": o.get("locId"), "species": set()})["species"].add(o["comName"])
        spots = sorted(({"name": v["name"], "locId": v["locId"], "species": len(v["species"])} for v in by.values()), key=lambda x: -x["species"])[:5]
    except Exception as e:
        errors.append(f"ebird recent: {e}")
else:
    errors.append("no EBIRD_KEY")

# ---- the call ----
DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
score, why = 50, []
if wx:
    d = DIRS[round(wx["windDir"] / 45) % 8]
    if wx["wind"] <= 8: score += 15; why.append("calm winds")
    elif wx["wind"] >= 18: score -= 20; why.append("windy")
    if wx["rain"] <= 20: score += 10
    elif wx["rain"] >= 60: score -= 25; why.append("rain likely")
    m = now.month
    if 8 <= m <= 11 and d in ("N", "NW"): score += 10; why.append("NW tailwind for fall migrants")
    if 3 <= m <= 6 and d in ("S", "SW"): score += 10; why.append("SW tailwind for spring migrants")
else:
    why.append("no weather data")
if len(notable) >= 3: score += 10; why.append(f"{len(notable)} notable reports nearby")
grade = "go" if score >= 70 else "maybe" if score >= 45 else "stay"
word = {"go": "GO", "maybe": "MAYBE", "stay": "STAY IN"}[grade]
headline = {"go": "Get out there.", "maybe": "Worth a look.", "stay": "Coffee first."}[grade]

brief = {"generated": now.isoformat(), "date": now.strftime("%Y-%m-%d"), "word": word, "grade": grade, "score": score, "headline": headline,
         "why": why, "wx": wx, "spots": spots, "notable": notable, "errors": errors}

# ---- text version for email ----
L = [f"{word} — {headline}  (score {score})", " · ".join(why) if why else "Average conditions.", ""]
if wx:
    L.append(f"{wx['temp']}°F · wind {wx['wind']} mph {DIRS[round(wx['windDir']/45)%8]} · rain {wx['rain']}% · sunrise {wx['sunrise']}")
L.append("Migration last night: https://dashboard.birdcast.info/region/US-NH-009")
L.append("")
L.append("Where to go (species reported, last 3 days):")
for i, s in enumerate(spots, 1):
    link = f" — https://ebird.org/hotspot/{s['locId']}" if s.get("locId") else ""
    L.append(f"{i}. {s['name']} — {s['species']} species{link}")
if not spots: L.append("(no eBird data)")
L.append("")
L.append("Notable nearby:")
for o in notable:
    n = f" ×{o['howMany']}" if o.get("howMany") else ""
    L.append(f"- {o['comName']}{n} — {o['locName']}, {o.get('obsDt','')} — https://ebird.org/checklist/{o.get('subId','')}")
if not notable: L.append("Nothing notable in range.")
L.append("")
L.append(f"Full brief and passes: {SITE}")
L.append("Grade yesterday's call on the site so the accuracy score improves.")
if errors: L.append(""); L.append("Data notes: " + "; ".join(errors))

os.makedirs("data", exist_ok=True)
json.dump(brief, open("data/brief.json", "w"), indent=1)
open("data/brief.txt", "w").write("\n".join(L) + "\n")
print("\n".join(L))
