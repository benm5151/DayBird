#!/usr/bin/env node
// Builds the Daybird bird art: art/birds/<slug>.svg and art/callouts/<slug>.svg from outline points.
//   node scripts/build_art.mjs            writes the SVGs
//   node scripts/build_art.mjs --png      also renders 240 px previews and art/contact-sheet.png (needs the sharp package;
//                                         set SHARP_PATH to its folder when it is not in node_modules)
// How a bird is written: `body` is the outline, clockwise from the bill tip, as [x, y, flags] points in a 240 × 240 box.
// Flags: 'c' makes a corner (bill tip, tail corners, wing fingers); 'k0.25' changes the handle length on that point.
// Points are joined with smooth cubic curves, so a bird is a list of 15-20 places the outline passes through, not
// hand-written Béziers. `eye` is a hole, `wing` a thin crescent hole, `legs` and `perch` are strokes, `accent` the one
// amber shape (a point list, a path string, or a function that reuses part of the outline so the edges meet exactly).
// Every file uses only ink #1F2A37 and amber #E8833A; the paper #F6F3EC shows through the holes.
import { writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INK = '#1F2A37', AMBER = '#E8833A', PAPER = '#F6F3EC';
const branch = 'M34 214C96 207 158 207 214 214';
const ground = 'M40 218L206 218';

// ---------- geometry ----------
// geometry helpers: smooth closed paths from outline points
const r1 = (v) => Math.round(v * 10) / 10;

function prep(pts) {
  const n = pts.length;
  const P = pts.map(p => ({ x: p[0], y: p[1], c: /c/.test(p[2] || ''), k: (p[2] || '').match(/k([\d.]+)/) ? +(p[2].match(/k([\d.]+)/)[1]) : 0.36 }));
  const unit = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
  for (let i = 0; i < n; i++) {
    const prev = P[(i - 1 + n) % n], next = P[(i + 1) % n], p = P[i];
    const tin = unit(prev, p), tout = unit(p, next);
    if (p.c) { p.tin = tin; p.tout = tout; }
    else { let t = { x: tin.x + tout.x, y: tin.y + tout.y }; const l = Math.hypot(t.x, t.y); t = l < 1e-6 ? tout : { x: t.x / l, y: t.y / l }; p.tin = p.tout = t; }
  }
  return P;
}
// path segment from point i to point j along the outline (wrapping)
function seg(pts, i, j) {
  const P = prep(pts), n = P.length;
  let d = '';
  for (let a = i; ; a = (a + 1) % n) {
    const b = (a + 1) % n, A = P[a], B = P[b];
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    const c1 = { x: A.x + A.tout.x * L * A.k, y: A.y + A.tout.y * L * A.k };
    const c2 = { x: B.x - B.tin.x * L * B.k, y: B.y - B.tin.y * L * B.k };
    d += `C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(B.x)} ${r1(B.y)}`;
    if (b === j) break;
  }
  return d;
}
function smooth(pts) { return `M${r1(pts[0][0])} ${r1(pts[0][1])}${seg(pts, 0, 0)}Z`; }
function circle(x, y, r) { return `M${r1(x - r)} ${r1(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`; }
function poly(pts) { return 'M' + pts.map(p => `${r1(p[0])} ${r1(p[1])}`).join('L') + 'Z'; }

// thin crescent (a wing crease) between two points; bows are perpendicular offsets of the two curves' control points
function sliver(p0, p1, bowA = 16, bowB = 9) {
  const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l; // left-hand normal
  return `M${r1(p0[0])} ${r1(p0[1])}Q${r1(mx + nx * bowA)} ${r1(my + ny * bowA)} ${r1(p1[0])} ${r1(p1[1])}Q${r1(mx + nx * bowB)} ${r1(my + ny * bowB)} ${r1(p0[0])} ${r1(p0[1])}Z`;
}

// ---------- the twelve ----------
const BIRDS = [
  {
    slug: 'black-capped-chickadee', name: 'Black-capped Chickadee', mark: 'cheek',
    label: 'Black-capped Chickadee silhouette, amber cheek patch',
    // big round head, no neck, plump body, long narrow tail
    body: [
      [50, 99, 'c'], [64, 88], [90, 56], [126, 66], [140, 94], [162, 112], [180, 136],
      [220, 172, 'c'], [215, 182, 'c'], [172, 158], [150, 178], [116, 184], [82, 162], [60, 126], [60, 108],
    ],
    eye: [74, 88, 4.5],
    wing: sliver([120, 108], [178, 156], 14, 8),
    legs: [[110, 182, 104, 210], [128, 183, 134, 210]], perch: branch,
    // white cheek: wedge under the cap, from the bill base back to the nape, widest at the back
    accent: [[62, 97, 'c'], [84, 94], [110, 94], [130, 100, 'c'], [122, 114], [100, 120], [78, 114], [64, 104]],
    callout: { at: [106, 106], to: [158, 52], text: 'white cheek' },
  },
  {
    slug: 'blue-jay', name: 'Blue Jay', mark: 'crest',
    label: 'Blue Jay silhouette, amber crest',
    // crest swept back and up, stout straight bill, long rounded tail
    body: [
      [40, 102, 'c'], [66, 90], [78, 74], [98, 58], [118, 48], [140, 42, 'c'], [134, 64], [140, 94], [166, 118], [190, 142],
      [230, 186, 'c'], [222, 200, 'c'], [178, 166], [150, 184], [116, 186], [86, 164], [64, 132], [66, 108],
    ],
    eye: [74, 94, 4.5],
    wing: sliver([120, 118], [192, 172], 14, 8),
    legs: [[120, 186, 116, 212], [140, 186, 146, 212]], perch: branch,
    accent: () => `M78 74${seg(BIRDS[1].body, 2, 7)}C128 86 112 80 96 80C88 80 82 78 78 74Z`,
    callout: null,
  },
  {
    slug: 'northern-cardinal', name: 'Northern Cardinal', mark: 'bill',
    label: 'Northern Cardinal silhouette, amber bill',
    // tall pointed crest, thick cone bill, long tail
    body: [
      [48, 106, 'c'], [68, 88, 'c'], [78, 74], [92, 58], [108, 36, 'c'], [118, 64], [128, 92], [158, 116], [182, 142],
      [224, 186, 'c'], [216, 200, 'c'], [174, 166], [150, 186], [116, 190], [84, 168], [62, 136], [64, 120, 'c'],
    ],
    eye: [78, 95, 4.5],
    wing: sliver([118, 118], [188, 172], 14, 8),
    legs: [[120, 190, 116, 214], [140, 190, 146, 214]], perch: branch,
    accent: () => `M64 120${seg(BIRDS[2].body, 16, 1)}C70 98 70 110 64 120Z`,
    callout: null,
  },
  {
    slug: 'american-robin', name: 'American Robin', mark: 'breast',
    label: 'American Robin silhouette, amber breast',
    // upright, round head, thin bill, long legs, longish tail
    body: [
      [40, 76, 'c'], [66, 66], [76, 50], [96, 40], [122, 50], [136, 74], [158, 112], [178, 150],
      [214, 198, 'c'], [204, 208, 'c'], [168, 172], [146, 186], [112, 186], [82, 154], [64, 116], [56, 92], [66, 84],
    ],
    eye: [76, 64, 4.5],
    wing: sliver([124, 100], [176, 162], 13, 7),
    legs: [[116, 186, 110, 216], [136, 184, 140, 216]], perch: ground, perchW: 5,
    accent: () => `M112 186${seg(BIRDS[3].body, 12, 15)}C88 98 118 120 130 148C136 166 132 180 112 186Z`,
    callout: null,
  },
  {
    slug: 'downy-woodpecker', name: 'Downy Woodpecker', mark: 'nape spot',
    label: 'Downy Woodpecker silhouette on a trunk, amber nape spot',
    // compact, clinging upright, short stubby bill, tail braced on the trunk
    body: [
      [60, 52, 'c'], [72, 44], [90, 38], [110, 46], [116, 68], [122, 98], [124, 128], [116, 158], [102, 178],
      [72, 208, 'c'], [62, 202, 'c'], [78, 170], [76, 146], [72, 112], [70, 82], [64, 62],
    ],
    eye: [82, 54, 4],
    wing: sliver([108, 76], [122, 150], 12, 6),
    legs: [[78, 134, 50, 128], [78, 148, 50, 150]], perch: 'M44 16C40 80 40 160 44 232', perchW: 16,
    accent: circle(111, 56, 6),
    callout: null,
  },
  {
    slug: 'white-breasted-nuthatch', name: 'White-breasted Nuthatch', mark: 'undertail',
    label: 'White-breasted Nuthatch silhouette head-down on a trunk, amber undertail',
    // head-down, head bent out, long straight bill, short square tail, no neck
    body: [
      [44, 170, 'c'], [74, 160], [90, 144], [108, 142], [126, 130], [148, 104], [164, 76],
      [168, 46, 'c'], [186, 50, 'c'], [184, 80], [178, 104], [166, 132], [148, 160], [126, 184], [102, 192], [78, 178],
    ],
    eye: [90, 164, 4],
    wing: sliver([134, 134], [166, 82], 11, 6),
    legs: [[168, 124, 200, 114], [162, 146, 200, 148]], perch: 'M206 14C210 80 210 160 206 232', perchW: 16,
    accent: [[174, 78], [186, 76], [184, 96], [178, 108], [170, 102]],
    callout: null,
  },
  {
    slug: 'american-goldfinch', name: 'American Goldfinch', mark: 'wing bar',
    label: 'American Goldfinch silhouette, amber wing bar',
    // small, conical bill, short notched tail
    body: [
      [52, 104, 'c'], [66, 94], [76, 78], [96, 64], [122, 70], [134, 88], [160, 112], [180, 134],
      [212, 158, 'c'], [200, 170, 'c'], [210, 182, 'c'], [174, 160], [150, 180], [116, 184], [82, 162], [62, 130], [62, 112, 'c'],
    ],
    eye: [74, 96, 4.5],
    wing: sliver([118, 104], [184, 152], 13, 7),
    legs: [[112, 182, 106, 210], [130, 183, 136, 210]], perch: branch,
    accent: [[154, 114, 'c'], [162, 120, 'c'], [150, 142, 'c'], [140, 138, 'c']],
    callout: { at: [151, 128], to: [172, 86], text: 'wing bar' },
  },
  {
    slug: 'dark-eyed-junco', name: 'Dark-eyed Junco', mark: 'outer tail feathers',
    label: 'Dark-eyed Junco silhouette, amber outer tail feathers',
    // round and plump, small bill, medium tail
    body: [
      [52, 106, 'c'], [66, 96], [76, 80], [98, 64], [124, 70], [136, 88], [162, 110], [182, 134],
      [222, 170, 'c'], [214, 184, 'c'], [174, 160], [150, 182], [116, 186], [82, 164], [62, 132], [62, 114, 'c'],
    ],
    eye: [74, 98, 4.5],
    wing: sliver([118, 108], [186, 154], 13, 7),
    legs: [[112, 184, 106, 210], [130, 185, 136, 210]], perch: branch,
    accent: [[176, 158, 'c'], [214, 184, 'c'], [218, 177, 'c'], [181, 152, 'c']],
    callout: { at: [198, 172], to: [226, 74], anchor: 'end', lines: ['white outer', 'tail'] },
  },
  {
    slug: 'song-sparrow', name: 'Song Sparrow', mark: 'breast spot',
    label: 'Song Sparrow silhouette, amber breast spot',
    // long rounded tail, round head, conical bill
    body: [
      [50, 108, 'c'], [66, 98], [76, 82], [98, 66], [124, 72], [136, 90], [162, 112], [182, 136],
      [226, 172], [230, 184], [220, 194], [172, 162], [150, 184], [116, 188], [82, 166], [62, 134], [62, 116, 'c'],
    ],
    eye: [74, 100, 4.5],
    wing: sliver([118, 110], [186, 156], 13, 7),
    legs: [[112, 186, 106, 212], [130, 187, 136, 212]], perch: branch,
    accent: [[84, 134], [90, 139], [90, 150], [84, 156], [78, 150], [77, 139]],
    callout: { at: [84, 145], to: [52, 172], anchor: 'middle', text: 'breast spot' },
  },
  {
    slug: 'red-tailed-hawk', name: 'Red-tailed Hawk', mark: 'belly band',
    label: 'Red-tailed Hawk soaring, seen from below, amber belly band',
    body: [
      [120, 52], [134, 64], [133, 80], [152, 80], [190, 84], [214, 90],
      [234, 104, 'c'], [223, 111, 'c'], [232, 121, 'c'], [218, 124, 'c'], [225, 136, 'c'], [210, 135, 'c'], [213, 147, 'c'], [199, 143, 'c'],
      [182, 153], [160, 157], [145, 150, 'c'], [144, 160],
      [170, 186, 'c'], [146, 196], [120, 199], [94, 196], [70, 186, 'c'],
      [96, 160], [95, 150, 'c'], [80, 157], [58, 153],
      [41, 143, 'c'], [27, 147, 'c'], [30, 135, 'c'], [15, 136, 'c'], [22, 124, 'c'], [8, 121, 'c'], [17, 111, 'c'], [6, 104, 'c'],
      [26, 90], [50, 84], [88, 80], [107, 80], [106, 64],
    ],
    eye: null,
    accent: [[97, 116, 'c'], [120, 120], [143, 116, 'c'], [144, 136, 'c'], [120, 140], [96, 136, 'c']],
    callout: { at: [143, 126], to: [186, 176], anchor: 'start', lines: ['belly', 'band'] },
  },
  {
    slug: 'mallard', name: 'Mallard', mark: 'bill',
    label: 'Mallard drake silhouette on water, amber bill',
    // long broad bill, sloping forehead, short neck, chest forward, back arching to a raised tail with the drake's curl
    body: [
      [18, 108, 'c'], [44, 100], [64, 92], [72, 80], [90, 70], [110, 78], [114, 100], [118, 112], [146, 108], [186, 112], [210, 124],
      [216, 114, 'c'], [222, 110, 'c'], [226, 126], [238, 140, 'c'], [234, 170, 'c'], [64, 170, 'c'], [54, 148], [66, 128], [74, 114], [62, 108], [40, 114],
    ],
    eye: [80, 90, 4],
    wing: sliver([132, 124], [214, 138], 10, 5),
    perch: 'M10 172L236 172', perchW: 4,
    accent: () => `M62 110${seg(BIRDS[10].body, 20, 2)}C64 100 63 106 62 110Z`,
    callout: null,
  },
  {
    slug: 'canada-goose', name: 'Canada Goose', mark: 'chin strap',
    label: 'Canada Goose silhouette standing, amber chin strap',
    body: [
      [22, 74, 'c'], [48, 62], [58, 50], [74, 40], [94, 46], [100, 62], [104, 90], [108, 118], [118, 134], [156, 128], [212, 140],
      [226, 158, 'c'], [216, 170, 'c'], [190, 190], [140, 196], [96, 180], [86, 156], [90, 124], [86, 98], [76, 76], [60, 76], [48, 78],
    ],
    eye: [66, 54, 4],
    wing: sliver([124, 142], [208, 152], 10, 5),
    legs: [[130, 196, 126, 216], [156, 196, 160, 216]], perch: ground, perchW: 5,
    accent: () => `M76 76${seg(BIRDS[11].body, 19, 21)}C56 66 66 60 80 58C94 58 98 64 96 74C92 80 84 80 76 76Z`,
    callout: { at: [80, 74], to: [128, 40], text: 'chin strap' },
  },
];

// ---------- svg ----------
function svgFor(b) {
  const body = smooth(b.body);
  const holes = (b.eye ? circle(...b.eye) : '') + (b.wing ? (typeof b.wing === 'string' ? b.wing : smooth(b.wing)) : '');
  const accent = typeof b.accent === 'function' ? b.accent() : (typeof b.accent === 'string' ? b.accent : smooth(b.accent));
  const strokes = [];
  if (b.legs) strokes.push(`<path d="${b.legs.map(l => `M${l[0]} ${l[1]}L${l[2]} ${l[3]}`).join('')}" fill="none" stroke="${INK}" stroke-width="${b.legW || 5}" stroke-linecap="round"/>`);
  if (b.perch) strokes.push(`<path d="${b.perch}" fill="none" stroke="${INK}" stroke-width="${b.perchW || 7}" stroke-linecap="round"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="${b.label}">
<path fill="${INK}" fill-rule="evenodd" d="${body}${holes}"/>
${strokes.join('\n')}
<path fill="${AMBER}" d="${accent}"/>
</svg>
`;
}
function calloutFor(b, svg) {
  // one thin amber leader from the accent to open paper, label in serif; lines stack away from the leader end
  const { at: [ax, ay], to: [lx, ly], anchor = 'start' } = b.callout;
  const lines = b.callout.lines || [b.callout.text];
  const tx = anchor === 'start' ? lx + 5 : anchor === 'end' ? lx - 5 : lx;
  const text = lines.map((t, i) => {
    const y = anchor === 'middle' ? ly + 16 + i * 15 : ly + 4.5 - (lines.length - 1 - i) * 15;
    return `<text x="${tx}" y="${r1(y)}" text-anchor="${anchor}" font-family="Iowan Old Style,Palatino Linotype,Palatino,Georgia,serif" font-size="13" fill="${INK}">${t}</text>`;
  }).join('\n');
  return svg.replace('</svg>', `<path d="M${ax} ${ay}L${lx} ${ly}" fill="none" stroke="${AMBER}" stroke-width="1.5" stroke-linecap="round"/>
<circle cx="${ax}" cy="${ay}" r="2.6" fill="${AMBER}"/>
${text}
</svg>`).replace(/aria-label="[^"]*"/, `aria-label="${b.name}: ${lines.join(' ')}"`);
}

// ---------- build ----------
const PNG = process.argv.includes('--png');
let sharp = null;
if (PNG) {
  const req = createRequire(import.meta.url);
  try { sharp = req(process.env.SHARP_PATH || 'sharp'); } catch { console.error('sharp not found; set SHARP_PATH or npm install sharp. Writing SVGs only.'); }
}
await mkdir(join(ROOT, 'art/birds'), { recursive: true });
await mkdir(join(ROOT, 'art/callouts'), { recursive: true });
const tiles = [];
for (const b of BIRDS) {
  const svg = svgFor(b);
  await writeFile(join(ROOT, 'art/birds', `${b.slug}.svg`), svg);
  if (b.callout) await writeFile(join(ROOT, 'art/callouts', `${b.slug}.svg`), calloutFor(b, svg));
  if (sharp) tiles.push({ b, png: await sharp(Buffer.from(svg), { density: 300 }).resize(240, 240).flatten({ background: PAPER }).png().toBuffer() });
  console.log(`${b.slug}.svg  ${svg.length} bytes${b.callout ? '  + callout' : ''}`);
}
if (sharp) {
  // contact sheet: 4 × 3 tiles with the name and the field mark under each
  const T = 260, cols = 4, rows = Math.ceil(tiles.length / cols), labelH = 34;
  const sheetW = cols * T + 20, sheetH = rows * (T + labelH) + 20;
  const comps = [], labels = [];
  tiles.forEach(({ b, png }, i) => {
    const x = 10 + (i % cols) * T, y = 10 + Math.floor(i / cols) * (T + labelH);
    comps.push({ input: png, left: x + 10, top: y + 10 });
    labels.push(`<text x="${x + T / 2}" y="${y + T + 16}" text-anchor="middle" font-family="DejaVu Serif,Georgia,serif" font-size="15" fill="${INK}">${b.name}</text><text x="${x + T / 2}" y="${y + T + 32}" text-anchor="middle" font-family="DejaVu Sans,Helvetica,sans-serif" font-size="11" fill="#5f6b63">amber: ${b.mark}</text>`);
  });
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}">${labels.join('')}</svg>`);
  await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: PAPER } }).composite([...comps, { input: overlay, left: 0, top: 0 }]).png().toFile(join(ROOT, 'art/contact-sheet.png'));
  console.log('art/contact-sheet.png');
}
