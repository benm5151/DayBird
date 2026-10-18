#!/usr/bin/env node
// Build the Daybird morning brief: data/brief.json + data/brief.txt.
// Runs in GitHub Actions (see .github/workflows/brief.yml). Needs EBIRD_KEY in the environment.
// Scoring and wording come from js/brief.js, the same engine the site and the email function use.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../js/brief.js');
require('../data/traits.js');
const B = globalThis.DAYBIRD_BRIEF;

const LAT = 43.6423, LNG = -72.2518, DIST = 25, BACK = 3; // Lebanon, NH
const PLACE = 'Lebanon, New Hampshire';
const KEY = (process.env.EBIRD_KEY || '').trim();
const SITE = 'https://benm5151.github.io/DayBird/';

async function get(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
  return r.json();
}

const errors = [];
let weather = null;
try { weather = B.parseWeather(await get(B.weatherUrl(LAT, LNG)), { forceToday: true }); }
catch (e) { errors.push(`weather: ${e.message}`); }

let eb = { notable: [], spots: [], recent: [] };
if (KEY) {
  const H = { 'X-eBirdApiToken': KEY };
  const q = `lat=${LAT}&lng=${LNG}&dist=${DIST}&back=${BACK}`;
  const [n, r] = await Promise.allSettled([
    get(`https://api.ebird.org/v2/data/obs/geo/recent/notable?${q}&detail=simple`, H),
    get(`https://api.ebird.org/v2/data/obs/geo/recent?${q}`, H),
  ]);
  if (n.status === 'rejected') errors.push(`ebird notable: ${n.reason.message}`);
  if (r.status === 'rejected') errors.push(`ebird recent: ${r.reason.message}`);
  eb = B.parseEbird(n.status === 'fulfilled' ? n.value : [], r.status === 'fulfilled' ? r.value : []);
} else errors.push('no EBIRD_KEY');

const now = new Date();
const date = weather ? weather.date : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
const brief = B.compose({ place: PLACE, date, whenLabel: 'this morning', wx: weather && weather.wx, tomorrow: weather && weather.tomorrow, ...eb, traits: globalThis.DAYBIRD_TRAITS });

// JSON keeps the shape the site has always read (word, grade, score, headline, why, wx, spots, notable) plus the new fields.
const out = { generated: now.toISOString(), date, word: brief.call.word, grade: brief.call.grade, score: brief.call.score, headline: brief.call.headline,
  why: brief.why, whyLine: brief.whyLine, wear: brief.wear, firstSong: brief.firstSong, leaveBy: brief.leaveBy, lookFor: brief.lookFor, groupsLine: brief.groupsLine,
  soaring: brief.soaring, tomorrow: brief.tomorrow, wx: brief.wx, spots: brief.spots, notable: brief.notable, recent: eb.recent, recentCount: brief.recentCount, errors, engine: B.VERSION };
const text = B.text(brief, { site: SITE, note: errors.length ? 'Data notes: ' + errors.join('; ') : '', footer: ["Grade yesterday's call on the site so the accuracy score improves."] });

mkdirSync('data', { recursive: true });
writeFileSync('data/brief.json', JSON.stringify(out, null, 1));
writeFileSync('data/brief.txt', text);
process.stdout.write(text);
