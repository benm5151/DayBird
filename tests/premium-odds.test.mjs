// Unit tests for js/odds.js (DAYBIRD_ODDS), the premium-preview estimates. Plain Node, no network:
//   node --test tests/premium-odds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../js/brief.js'); require('../data/traits.js'); require('../js/odds.js'); require('../data/windows.js');
const O = globalThis.DAYBIRD_ODDS, B = globalThis.DAYBIRD_BRIEF, W = globalThis.DAYBIRD_WINDOWS;

const calm = { temp: 40, wind: 5, windDir: 315, rain: 10, sunrise: '07:05' };
const rainy = { ...calm, rain: 70 };
const windy = { ...calm, wind: 20 };

test('spot odds: bounded to 3%–95%, monotonic in score and in species, lowered by rain and wind', () => {
  for (const species of [0, 3, 15, 34, 60, 120, 999]) for (const score of [-20, 0, 30, 50, 70, 85, 120, 500]) for (const wx of [null, calm, rainy, windy]) {
    const p = O.spotOdds({ species, score, wx }).p;
    assert.ok(p >= 0.03 && p <= 0.95, `${species} ${score} → ${p}`);
  }
  assert.equal(O.spotOdds({ species: 0, score: 85, wx: calm }).p, 0.03);
  assert.equal(O.spotOdds({ species: 300, score: 120, wx: calm }).p, 0.95);
  assert.equal(O.spotOdds({ species: NaN, score: NaN, wx: null }).p, 0.03, 'garbage in → floor, not NaN');
  // 15 a day (45 over 3 days) is even odds before scaling, and a score of 70 is neutral
  assert.equal(O.spotOdds({ species: 45, score: 70, wx: null }).p, 0.5);
  let last = 0;
  for (const score of [10, 30, 45, 60, 70, 85, 95, 110]) { const p = O.spotOdds({ species: 34, score, wx: calm }).p; assert.ok(p >= last, `score ${score}`); last = p; }
  last = 0;
  for (const sp of [3, 10, 20, 34, 45, 60]) { const p = O.spotOdds({ species: sp, score: 85, wx: calm }).p; assert.ok(p >= last, `species ${sp}`); last = p; }
  const base = O.spotOdds({ species: 34, score: 85, wx: calm }).p;
  assert.ok(O.spotOdds({ species: 34, score: 85, wx: rainy }).p < base, 'rain lowers');
  assert.ok(O.spotOdds({ species: 34, score: 85, wx: windy }).p < base, 'wind lowers');
  assert.ok(O.spotOdds({ species: 34, score: 85, wx: { ...calm, rain: 70, wind: 20 } }).p < O.spotOdds({ species: 34, score: 85, wx: rainy }).p, 'both is worse than one');
  assert.equal(O.weatherPenalty(rainy), 0.6); assert.equal(O.weatherPenalty({ ...calm, rain: 45 }), 0.8); assert.equal(O.weatherPenalty(windy), 0.7); assert.equal(O.weatherPenalty({ ...calm, wind: 13 }), 0.85);
  assert.equal(O.scaleFor(70), 1); assert.equal(O.scaleFor(0), 0.3); assert.equal(O.scaleFor(200), 1.3);
});

test('species odds: reported nearby beats not reported, season table applies by group, bounded', () => {
  const inR = O.speciesOdds({ name: 'Yellow-rumped Warbler', recent: ['Yellow-rumped Warbler', 'Blue Jay'], score: 85, wx: calm, month: 10 });
  const notR = O.speciesOdds({ name: 'Yellow-rumped Warbler', recent: ['Blue Jay'], score: 85, wx: calm, month: 10 });
  assert.ok(inR.inRecent && !notR.inRecent);
  assert.equal(inR.base, 0.55); assert.equal(notR.base, 0.08);
  assert.ok(inR.p > notR.p);
  assert.equal(inR.group, 'warblers'); assert.equal(inR.season, 0.6);
  // case-insensitive match, and {comName} rows work like strings
  assert.ok(O.speciesOdds({ name: 'blue jay', recent: [{ comName: 'Blue Jay' }], score: 70, wx: null, month: 6 }).inRecent);
  // season: a warbler in May vs January; a winter finch the other way round
  const may = O.speciesOdds({ name: 'Magnolia Warbler', recent: ['Magnolia Warbler'], score: 70, wx: null, month: 5 }).p;
  const jan = O.speciesOdds({ name: 'Magnolia Warbler', recent: ['Magnolia Warbler'], score: 70, wx: null, month: 1 }).p;
  assert.ok(may > jan); assert.equal(O.seasonFactor('warblers', 5), 1.2); assert.equal(O.seasonFactor('warblers', 1), 0.1);
  assert.ok(O.seasonFactor('finches', 1) > O.seasonFactor('finches', 6));
  assert.equal(O.seasonFactor('gulls', 7), 1, 'groups without a row are 1 all year');
  assert.equal(O.seasonFactor(null, 7), 1); assert.equal(O.seasonFactor('warblers', 0), 0.1); assert.equal(O.seasonFactor('warblers', 13), 0.1);
  for (const month of [1, 5, 10]) for (const score of [0, 70, 120]) for (const wx of [null, rainy]) for (const name of ['Barn Swallow', 'Common Raven', 'Zzz Bird']) {
    const p = O.speciesOdds({ name, recent: ['Barn Swallow'], score, wx, month }).p;
    assert.ok(p >= 0.03 && p <= 0.95, `${name} ${month} ${score} → ${p}`);
  }
  assert.equal(O.speciesOdds({ name: 'Barn Swallow', recent: [], score: 0, wx: rainy, month: 1 }).p, 0.03, 'a swallow in January hits the floor');
  assert.ok(O.speciesOdds({ name: 'Barn Swallow', recent: ['Barn Swallow'], score: 85, wx: calm, month: 10 }).p < inR.p, 'rain and season both pull down');
  assert.equal(O.pct(0.384), '38%'); assert.equal(O.pct(0.999), '95%'); assert.equal(O.pct(0), '3%');
});

const daily = (() => {
  const time = Array.from({ length: 7 }, (_, i) => `2026-10-${18 + i}`);
  return { time, temperature_2m_max: [58, 60, 50, 45, 52, 55, 50], temperature_2m_min: [35, 38, 30, 28, 33, 36, 31], precipitation_probability_max: [10, 80, 20, 5, 40, 10, 65],
    wind_speed_10m_max: [8, 25, 10, 6, 15, 9, 30], wind_direction_10m_dominant: [315, 180, 300, 320, 200, 310, 180], sunrise: time.map((d, i) => `${d}T07:${String(5 + i).padStart(2, '0')}`) };
})();

test('day scoring from daily fields: builds a wx per day the engine can score, same thresholds as the brief', () => {
  const wx = O.wxFromDaily(daily, 0);
  assert.deepEqual({ temp: wx.temp, wind: wx.wind, windDir: wx.windDir, rain: wx.rain, high: wx.high, low: wx.low, sunrise: wx.sunrise, date: wx.date, approx: wx.approx },
    { temp: 35, wind: 6, windDir: 315, rain: 10, high: 58, low: 35, sunrise: '07:05', date: '2026-10-18', approx: true });
  assert.equal(O.wxFromDaily(daily, 9), null); assert.equal(O.wxFromDaily(null, 0), null);
  assert.equal(O.wxFromDaily({ time: ['2026-10-18'] }, 0), null, 'no temperatures → no day');
  const days = O.scoreDays(daily);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.call.word), ['GO', 'STAY IN', 'GO', 'GO', 'MAYBE', 'GO', 'STAY IN']);
  // the same wx through the engine directly gives the same score
  assert.equal(days[0].call.score, B.score({ wx: days[0].wx, month: 10 }).score);
  assert.equal(days[1].call.score, 50 - 20 - 25, 'windy and rainy with a south wind in October: no bonuses');
  assert.equal(days[0].call.score, 50 + 15 + 10 + 10, 'calm, dry, NW in fall');
  assert.deepEqual(O.scoreDays({ time: [] }), []); assert.deepEqual(O.scoreDays(null), []);
  assert.match(O.forecastUrl(43.64, -72.25), /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=43\.64&longitude=-72\.25&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,sunrise&timezone=auto&forecast_days=7&wind_speed_unit=mph&temperature_unit=fahrenheit$/);
});

test('target-bird planner: best three mornings, best hour by group, ID tip from the trait table, today filter', () => {
  const p = O.bestMornings({ name: 'Red-tailed Hawk', daily, recent: ['Red-tailed Hawk'], traits: globalThis.DAYBIRD_TRAITS, level: 'new', today: '2026-10-18' });
  assert.equal(p.group, 'raptors'); assert.equal(p.inRecent, true);
  assert.equal(p.best.length, 3);
  assert.deepEqual(p.best.map((d) => d.date), ['2026-10-18', '2026-10-20', '2026-10-21'], 'ties on odds go to the earlier day');
  assert.ok(p.best[0].p >= p.best[1].p && p.best[1].p >= p.best[2].p);
  assert.ok(p.best.every((d) => d.hour.time === '10:00' && d.hour.label === '10:00 AM'), 'raptors: late morning');
  assert.equal(p.tip, 'belly band, red tail, on highway poles');
  assert.equal(p.best[0].label, 'Sunday, Oct 18');
  // a songbird: 30 minutes after sunrise; owls: an hour before; ducks: an hour after
  const s = O.bestMornings({ name: 'Hermit Thrush', daily, recent: [], traits: globalThis.DAYBIRD_TRAITS, today: '2026-10-20' });
  assert.equal(s.inRecent, false); assert.equal(s.days.length, 5, 'days before today are dropped');
  assert.equal(s.best[0].hour.time, '07:37'); assert.equal(s.best[0].hour.label, '7:37 AM');
  assert.equal(O.bestHour('owls', '07:00').time, '06:00'); assert.equal(O.bestHour('waterfowl', '07:00').time, '08:00'); assert.equal(O.bestHour(null, '07:00').time, '07:30');
  // an unknown bird still gets mornings, no tip, no group
  const u = O.bestMornings({ name: 'Zzz Bird', daily, recent: [], traits: globalThis.DAYBIRD_TRAITS, today: '2026-10-18' });
  assert.equal(u.group, null); assert.equal(u.tip, ''); assert.equal(u.best.length, 3);
  // a group tip when the species is not in the trait table
  assert.match(O.idTip('Cape May Warbler', globalThis.DAYBIRD_TRAITS, 'new'), /Small, busy, often yellow/);
});

test('ics: one VEVENT with floating local start, end after the slot, escaped text, CRLF and folding', () => {
  const ics = O.ics({ date: '2026-10-21', time: '10:00', minutes: 90, title: 'Daybird: look for Red-tailed Hawk', location: 'Lebanon, New Hampshire', description: 'a, b; c\nline two', url: 'https://day-bird.com/plan.html', stamp: new Date('2026-10-18T12:00:00Z') });
  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR'); assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 1); assert.equal(lines.filter((l) => l === 'END:VEVENT').length, 1);
  assert.ok(lines.includes('DTSTART:20261021T100000')); assert.ok(lines.includes('DTEND:20261021T113000')); assert.ok(lines.includes('DTSTAMP:20261018T120000Z'));
  assert.ok(lines.includes('SUMMARY:Daybird: look for Red-tailed Hawk'));
  assert.ok(lines.includes('LOCATION:Lebanon\\, New Hampshire'));
  assert.ok(lines.includes('DESCRIPTION:a\\, b\\; c\\nline two'));
  assert.ok(lines.includes('URL:https://day-bird.com/plan.html'));
  assert.ok(lines.every((l) => l.length <= 75), 'lines are folded');
  const long = O.ics({ date: '2026-10-21', time: '07:00', title: 'x', description: 'y'.repeat(300) });
  assert.ok(long.split('\r\n').every((l) => l.length <= 75)); assert.ok(long.includes('\r\n y'), 'continuation lines start with a space');
  assert.ok(O.ics({ date: '2026-10-21' }).includes('DTSTART:20261021T070000'), 'defaults to 7:00 for 90 minutes');
});

test('route helpers: polyline sampling honours the ~10 km spacing and the 20-point cap; detour minutes; projector fits the box', () => {
  // a straight 250 km line with a vertex every km
  const coords = Array.from({ length: 251 }, (_, i) => [-72 - i * 0.0126, 43 + 0.0 * i]);
  const s = O.samplePolyline(coords, 10, 20);
  assert.ok(s.samples.length <= 20 && s.samples.length >= 18, `${s.samples.length} samples`);
  assert.ok(s.spacingKm >= 10, 'spacing widens so the cap holds');
  assert.equal(s.samples[0].km, 0); assert.equal(s.samples[s.samples.length - 1].km, s.lengthKm);
  assert.ok(s.samples.every((p) => String(p.lat).split('.')[1]?.length <= 2 && String(p.lng).split('.')[1]?.length <= 2 || true), 'rounded to 2 decimals');
  assert.ok(s.samples.every((p) => Math.abs(p.lat * 100 - Math.round(p.lat * 100)) < 1e-9 && Math.abs(p.lng * 100 - Math.round(p.lng * 100)) < 1e-9));
  const short = O.samplePolyline([[-72.25, 43.64], [-72.26, 43.65]], 10, 20);
  assert.equal(short.samples.length, 2, 'start and end at least'); assert.ok(short.lengthKm <= 2);
  assert.deepEqual(O.samplePolyline([], 10, 20).samples, []); assert.deepEqual(O.samplePolyline([[NaN, 1]], 10, 20).samples, []);
  const fifty = Array.from({ length: 51 }, (_, i) => [-72 - i * 0.0126, 43]);
  assert.ok(O.samplePolyline(fifty, 10, 20).samples.length <= 7, '50 km → about 6 samples at 10 km');
  // detour: a point ~11 km north of the line is ~26 min there and back at 50 km/h
  const d = O.detour(43.1, -72.5, coords);
  assert.ok(d.km > 10.5 && d.km < 11.5, d.km); assert.equal(d.min, Math.round((d.km / 50) * 60 * 2)); assert.ok(d.at >= 0);
  assert.ok(Number.isNaN(O.detour(43.1, -72.5, []).min));
  assert.ok(O.haversineKm(43.6423, -72.2518, 44.4759, -73.2121) > 110 && O.haversineKm(43.6423, -72.2518, 44.4759, -73.2121) < 125, 'Lebanon to Burlington');
  // projector: corners of the bounding box land inside the padded box, north is up
  const P = O.projector([{ lat: 43.64, lng: -72.25 }, { lat: 44.48, lng: -73.2 }, { lat: NaN, lng: 1 }], 640, 380, 24);
  const a = P.project(43.64, -72.25), b = P.project(44.48, -73.2);
  assert.ok(a.x >= 24 && a.x <= 616 && a.y >= 24 && a.y <= 356 && b.x >= 24 && b.x <= 616 && b.y >= 24 && b.y <= 356);
  assert.ok(b.y < a.y, 'north is up'); assert.ok(b.x < a.x, 'west is left');
  assert.equal(O.projector([], 640, 380), null);
  assert.ok(O.projector([{ lat: 43.64, lng: -72.25 }], 100, 100, 10).project(43.64, -72.25).x > 0, 'a single point still projects');
});

test('head-to-head: picks the best, says why in one sentence, distance unknown without coordinates', () => {
  const from = { lat: 43.64, lng: -72.25 };
  let r = O.headToHead([{ name: 'A', species: 34, lat: 43.7, lng: -72.3 }, { name: 'B', species: 14, lat: 43.65, lng: -72.26 }, { name: 'C', species: 6 }], from, 85, calm);
  assert.equal(r.best.name, 'A'); assert.match(r.why, /^A has the most species reported this week \(34\), which beats the shorter drive to B\.$/);
  assert.ok(r.rows[0].km > 7 && r.rows[0].km < 9); assert.ok(Number.isNaN(r.rows[2].km));
  assert.equal(r.rows.filter((x) => Number.isFinite(x.odds.p)).length, 3);
  r = O.headToHead([{ name: 'A', species: 34, lat: 43.65, lng: -72.26 }, { name: 'B', species: 14, lat: 43.7, lng: -72.3 }], from, 85, calm);
  assert.match(r.why, /^A has the most species reported this week \(34\) and it's the closest, about 1\.\d km away\.$/);
  r = O.headToHead([{ name: 'Only', species: 10 }], from, 85, calm);
  assert.equal(r.why, 'Only is the only spot picked.');
  r = O.headToHead([{ name: 'A', species: 20, lat: 43.7, lng: -72.3 }, { name: 'B', species: 20, lat: 43.65, lng: -72.26 }], from, 85, calm);
  assert.equal(r.best.name, 'B', 'equal odds → closer wins'); assert.match(r.why, /about even on odds, and B is closer/);
  r = O.headToHead([{ name: 'A', species: 20 }, { name: 'B', species: 20 }], null, 85, calm);
  assert.ok(r.best); assert.ok(r.why.length > 0);
  assert.deepEqual(O.headToHead([], from, 85, calm), { rows: [], best: null, why: '' });
  assert.ok(r.why.split('. ').length <= 2, 'one sentence');
});

test('migration windows: open now and opening soon, wrap across New Year, hand-written table shape', () => {
  assert.ok(W.length >= 20);
  for (const e of W) { assert.ok(e.key && e.name && e.windows.length); for (const w of e.windows) assert.match(w.from + w.to, /^(\d\d-\d\d){2}$/); }
  assert.equal(new Set(W.map((e) => e.key)).size, W.length, 'keys are unique');
  let st = O.windowState(W, '2026-10-18', 14);
  assert.ok(st.open.some((e) => e.key === 'sparrows-fall') && st.open.some((e) => e.key === 'kinglets-fall'));
  assert.equal(st.open.find((e) => e.key === 'sparrows-fall').daysLeft, 7);
  assert.deepEqual(st.soon.map((e) => [e.key, e.opensIn]).filter((x) => x[1] <= 2), [['late-hawks', 2], ['snow-goose', 2]]);
  assert.ok(st.soon.some((e) => e.key === 'winter-finches' && e.opensIn === 14));
  assert.ok(!st.soon.some((e) => e.key === 'owls-courtship'), 'January is not within 14 days');
  assert.ok(st.open.every((e, i, a) => i === 0 || a[i - 1].daysLeft <= e.daysLeft), 'open sorted by days left');
  assert.ok(st.soon.every((e, i, a) => i === 0 || a[i - 1].opensIn <= e.opensIn), 'soon sorted by opens-in');
  // across the new year: a Dec 1 – Feb 28 window is open on Dec 28 with 62 days left; Jan 1 opens in 4
  st = O.windowState(W, '2026-12-28', 14);
  assert.equal(st.open.find((e) => e.key === 'snowy-owl').daysLeft, 62);
  assert.equal(st.soon.find((e) => e.key === 'eagles-winter').opensIn, 4);
  st = O.windowState(W, '2027-01-10', 14);
  assert.ok(st.open.some((e) => e.key === 'snowy-owl') && st.open.some((e) => e.key === 'eagles-winter'));
  assert.equal(st.soon.find((e) => e.key === 'owls-courtship').opensIn, 5);
  // a species with two windows is listed once when inside one of them
  st = O.windowState(W, '2026-04-10', 14);
  assert.equal(st.open.filter((e) => e.key === 'rusty-blackbird').length, 1);
  assert.equal(O.mmddLabel('10-01'), 'Oct 1');
});

test('free mornings: 6:30–8:30 at the place, nudge line names the best free GO day', () => {
  const days = O.scoreDays(daily);
  const busy = [
    { start: '2026-10-18T11:00:00.000Z', end: '2026-10-18T12:00:00.000Z' },    // 7–8 AM EDT: busy
    { start: '2026-10-20T04:00:00.000Z', end: '2026-10-21T04:00:00.000Z' },    // all day Tuesday: busy
    { start: '2026-10-21T12:30:00.000Z', end: '2026-10-21T13:00:00.000Z' },    // 8:30–9:00: touches the end, not inside → free
    { start: '2026-10-22T10:00:00.000Z', end: '2026-10-22T10:30:00.000Z' },    // 6:00–6:30: ends as the window opens → free
    { start: '2026-10-23T10:00:00.000Z', end: '2026-10-23T10:31:00.000Z' },    // runs one minute into the window → busy
  ];
  const m = O.freeMornings(days, busy, 'America/New_York');
  assert.deepEqual(m.map((d) => d.free), [false, true, false, true, true, false, true]);
  assert.equal(m[0].busyCount, 1);
  assert.equal(O.nudgeLine(m), "You're free Wednesday 6:30–8:30 and it looks like a GO.");
  assert.equal(O.nudgeLine(m, '2026-10-21'), "You're free this morning 6:30–8:30 and it looks like a GO.");
  assert.equal(O.nudgeLine(m, '2026-10-20'), "You're free tomorrow 6:30–8:30 and it looks like a GO.");
  assert.equal(O.nudgeLine(m, '2026-10-18'), "You're free Wednesday 6:30–8:30 and it looks like a GO.", 'today is busy, so the weekday is named');
  assert.equal(O.nudgeLine(m.map((d) => ({ ...d, free: false }))), 'Every morning this week has something on the calendar between 6:30 and 8:30.');
  assert.match(O.nudgeLine([{ ...m[1], free: true }]), /looks like a STAY IN, so maybe sleep in/);
  assert.equal(O.freeMornings(days, [], 'America/New_York').every((d) => d.free), true);
  assert.equal(O.freeMornings(days, [{ start: 'garbage', end: 'x' }], 'America/New_York').every((d) => d.free), true, 'bad blocks are ignored');
  // zone math: 6:30 in New York on Oct 18 (EDT) is 10:30Z; a fake zone falls back without throwing
  assert.equal(O.zonedToUTC('2026-10-18', 6, 30, 'America/New_York').toISOString(), '2026-10-18T10:30:00.000Z');
  assert.equal(O.zonedToUTC('2026-12-18', 6, 30, 'America/New_York').toISOString(), '2026-12-18T11:30:00.000Z');
  assert.ok(O.zonedToUTC('2026-10-18', 6, 30, 'Mars/Olympus') instanceof Date);
});
