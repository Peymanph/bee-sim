'use strict';
/* HIVE — pixel bee colony sim.
   The hive lives in a hollow tree, not underground.
   Queen Hermes issues orders (queen-orders.json / command bar).
   Biology: real worker caste by age, nurse-fed larvae, separate pollen (protein)
   and honey (carbohydrate) stores, egg→larva→pupa timeline, emergency requeening.
   Ecology: weather hazards (storm / drought / heatwave / frost) plus real raids —
   a hornet squad, a wasp army or a bear walks up to the trunk, the colony
   mobilises its militia, fights it at the entrance and wins or loses.
   Personality: every bee is born bold, timid, diligent, frugal or social —
   it changes how she flies, eats, works and survives a disaster. */

// ---------- constants ----------
const IW = 320, IH = 200;
const GROUND = 168, T = 4;                 // grass line / tile size
const COLS = IW / T, ROWS = IH / T;
const DRAIN = 0.35;                        // sim-days per real second at 1×

const HPC = 12;                            // honey units held per comb cell
const PPC = 6;                             // pollen units held per comb cell

const EGG_D = 2.0;                         // days as egg   (real ~3)
const LARVA_D = 4.5;                       // days as larva (real ~6)
const PUPA_D = 7.0;                        // days as pupa  (real ~12)
const QCELL_D = 10;                        // days to rear a replacement queen

const NURSE_LO = 1, NURSE_HI = 12;         // ages that feed larvae
const FORAGE_AGE = 17;                     // only mature bees can fly out
const LARVA_PER_NURSE = 6;                 // larvae one nurse can keep fed
const LARVA_POLLEN_D = 0.70;               // pollen / larva / day (protein)
const LARVA_HONEY_D = 0.45;                // honey  / larva / day (energy)
const STALL_MAX = 2.6;                     // days unfed before a larva dies

// seasons are now EQUAL: every season blooms, every season rears brood.
// winter is only harder because of frost storms, not because it is empty.
const FLOWERS = [8, 14, 8, 8];             // spring / summer / autumn / winter
const YIELD = [1, 1.35, 0.8, 1.0];
const LAYRATE = [2.4, 3.4, 1.3, 2.0];
const SEASON = ['SPRING', 'SUMMER FLOW', 'AUTUMN', 'WINTER'];

const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ---------- rng ----------
let seed = (Date.now() ^ 0x9e3779b9) >>> 0;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

// ---------- queen orders (defaults, overridden by queen-orders.json) ----------
let ORDERS = {
  queen: 'HERMES',
  doctrine: 'BALANCED',
  forageRatio: 0.7,
  broodPriority: 0.7,
  winterReserve: 420,
  allowSwarm: false,
  allowBuild: true
};

// ---------- tree / hive geometry ----------
const HIVE = { x: 160, y: 112 };
const ENT = { x: 233, y: 140 };            // hole through the bark
const POKE = { x: 176, y: 140 };           // last point inside the hollow
const OUT = { x: 246, y: 140 };            // clear air just outside the trunk

// trunk tapers from a wide base to a narrow crown
function trunkHW(y) {
  if (y > GROUND + 8) return 0;
  const t = (GROUND - y) / (GROUND - 24);   // 0 at base, 1 at crown
  return Math.round(74 - 30 * Math.max(0, t));
}
function inTrunkPx(x, y) {
  if (y < 24 || y > GROUND + 4) return false;
  return Math.abs(x - 160) <= trunkHW(y);
}

// ---------- world state ----------
const S = {
  day: 1, year: 1, season: 0,
  speed: 1, paused: false, over: false,
  honey: 70, pollen: 8,
  workers: [], drones: [], comb: [], flowers: [],
  queenAlive: true, queenCell: null,
  queenT: 0, slotIdx: 0, free: [], dirty: true,
  layT: 0, buildT: 0, starveT: 0, roleT: 0, miteYear: -1, swarmT: 0,
  haz: null, hazCd: 24, raid: null,
  banner: null, bannerT: 0, logs: [], frame: 0
};

// ---------- tile grid: 1 = material (wood or dirt), 0 = void ----------
const solid = new Uint8Array(COLS * ROWS);
function isWood(cx, cy) {
  if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return false;
  const px = cx * T + 2, py = cy * T + 2;
  return py >= GROUND ? true : inTrunkPx(px, py);
}
function air(cx, cy) { return cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS && solid[cy * COLS + cx] === 0; }
function hollow(cx, cy) { return isWood(cx, cy) && !air(cx, cy) && (cy * T + 2) < GROUND; }
function cut(cx, cy) {
  if (!isWood(cx, cy)) return;
  const i = cy * COLS + cx;
  if (solid[i]) { solid[i] = 0; S.dirty = true; }
}
function disc(px, py, r) {
  const cx = px / T, cy = py / T, rt = r / T + 0.4;
  for (let y = Math.floor(cy - rt); y <= cy + rt; y++)
    for (let x = Math.floor(cx - rt); x <= cx + rt; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= rt * rt) cut(x, y);
    }
}
function slotRect(x1, y1, x2, y2) {
  for (let y = y1; y <= y2; y += T) for (let x = x1; x <= x2; x += T) cut(x / T | 0, y / T | 0);
}

// comb slots — outward spiral from the hive centre
const SLOTS = (function () {
  const a = [], n = 12, c = n;
  for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++)
    a.push({ dx, dy, r: Math.hypot(dx, dy) });
  a.sort((p, q) => p.r - q.r);
  return a;
})();
function slotPos(i) {
  const s = SLOTS[i];
  return { x: HIVE.x + s.dx * 7 + (Math.abs(s.dy) % 2 ? 3 : 0), y: HIVE.y + s.dy * 6 };
}
function fits(x, y) {
  if (y < 44 || y > 166) return false;
  return Math.abs(x - 160) <= trunkHW(y) - 16;   // 16px of bark stays intact
}
function addComb() {
  for (let guard = 0; guard < 900; guard++) {
    let i;
    if (S.free.length) i = S.free.pop();
    else if (S.slotIdx < SLOTS.length) i = S.slotIdx++;
    else return false;
    const p = slotPos(i);
    if (fits(p.x, p.y)) {
      disc(p.x, p.y, 4.6);
      S.comb.push({ x: p.x, y: p.y, kind: null, t: 0, stall: 0, slot: i });
      return true;
    }
  }
  return false;
}

// ---------- textures ----------
// bark: vertical grain + cracks
const bark = document.createElement('canvas');
bark.width = IW; bark.height = IH;
(function () {
  const g = bark.getContext('2d');
  const img = g.createImageData(IW, IH), d = img.data;
  const pal = [[133, 99, 66], [114, 84, 56], [155, 119, 79], [97, 71, 47], [172, 135, 92], [123, 91, 61]];
  for (let i = 0; i < d.length; i += 4) {
    let p = pal[(rnd() * pal.length) | 0];
    if (rnd() < 0.07) p = [58, 42, 28];
    if (rnd() < 0.05) p = [166, 134, 94];
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // vertical bark furrows
  for (let x = 0; x < IW;) {
    const w = 1 + ((rnd() * 3) | 0);
    const y0 = (rnd() * IH) | 0, h = 40 + ((rnd() * 160) | 0);
    g.fillStyle = 'rgba(58,40,25,0.34)'; g.fillRect(x, y0, w, h);
    g.fillStyle = 'rgba(205,175,130,0.17)'; g.fillRect(x + w, y0 + 8, 1, h - 16);
    x += 5 + ((rnd() * 5) | 0);
  }
  // knots
  for (let i = 0; i < 7; i++) {
    const x = 100 + ((rnd() * 120) | 0), y = 40 + ((rnd() * 120) | 0);
    g.fillStyle = 'rgba(52,36,22,.7)'; g.beginPath(); g.ellipse(x, y, 5, 7, 0, 0, 7); g.fill();
  }
})();

// soil band under the grass
const soil = document.createElement('canvas');
soil.width = IW; soil.height = IH - GROUND;
(function () {
  const g = soil.getContext('2d');
  const img = g.createImageData(soil.width, soil.height), d = img.data;
  const pal = [[201, 179, 136], [176, 151, 108], [224, 205, 165], [150, 126, 88], [194, 171, 129], [210, 188, 145]];
  for (let i = 0; i < d.length; i += 4) {
    let p = pal[(rnd() * pal.length) | 0];
    if (rnd() < 0.09) p = [98, 76, 52];
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let y = 6; y < soil.height; y += 13) {
    g.fillStyle = 'rgba(84,63,42,0.4)'; g.fillRect(0, y, soil.width, 2);
  }
})();

// static scenery: soil + grass + trunk + canopy (drawn once)
const base = document.createElement('canvas');
base.width = IW; base.height = IH;
function buildBase() {
  const g = base.getContext('2d');
  g.clearRect(0, 0, IW, IH);
  g.drawImage(soil, 0, GROUND);
  // grass band
  g.fillStyle = '#4f8f3a'; g.fillRect(0, GROUND, IW, 4);
  g.fillStyle = '#3f7a30'; g.fillRect(0, GROUND + 4, IW, 3);
  g.fillStyle = '#7cba5e';
  for (let x = 0; x < IW; x += 3) if (rnd() < 0.7) g.fillRect(x, GROUND - 2, 1, 3);

  // --- trunk silhouette, clipped bark texture ---
  g.save();
  g.beginPath();
  const yTop = 24, yBot = GROUND + 7;
  for (let y = yBot; y >= yTop; y -= 4) g.lineTo(160 - trunkHW(y), y);
  g.lineTo(160 - trunkHW(yTop), yTop);
  g.lineTo(160 + trunkHW(yTop), yTop);
  for (let y = yTop; y <= yBot; y += 4) g.lineTo(160 + trunkHW(y), y);
  g.closePath();
  g.clip();
  g.drawImage(bark, 0, 0);
  g.restore();
  // silhouette edge — the trunk must read against the sky
  g.strokeStyle = 'rgba(34,22,12,.92)'; g.lineWidth = 2;
  g.beginPath();
  for (let y = yBot; y >= yTop; y -= 4) g.lineTo(160 - trunkHW(y), y);
  g.lineTo(160 - trunkHW(yTop), yTop);
  g.lineTo(160 + trunkHW(yTop), yTop);
  for (let y = yTop; y <= yBot; y += 4) g.lineTo(160 + trunkHW(y), y);
  g.closePath(); g.stroke();

  // roots flaring over the grass
  g.save();
  g.fillStyle = '#5d452c';
  g.beginPath();
  g.moveTo(86, GROUND + 7); g.lineTo(100, GROUND - 4); g.lineTo(116, GROUND + 7); g.closePath(); g.fill();
  g.beginPath();
  g.moveTo(204, GROUND + 7); g.lineTo(220, GROUND - 5); g.lineTo(236, GROUND + 7); g.closePath(); g.fill();
  g.restore();

  // --- branches ---
  g.strokeStyle = '#4d3925'; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(140, 44); g.lineTo(96, 34); g.lineTo(66, 44); g.stroke();
  g.beginPath(); g.moveTo(182, 42); g.lineTo(226, 32); g.lineTo(256, 44); g.stroke();
  g.beginPath(); g.moveTo(160, 34); g.lineTo(160, 16); g.stroke();

  // --- canopy: pixel leaves on a 4px grid ---
  const blobs = [[104, 36, 40], [160, 24, 48], [216, 36, 40], [68, 54, 28], [252, 54, 28], [128, 14, 34], [194, 14, 34]];
  for (let cy = -4; cy < 78; cy += 4) for (let cx = 0; cx < IW; cx += 4) {
    const px = cx + 2, py = cy + 2;
    let inside = 0;
    for (const b of blobs) { const dx = px - b[0], dy = (py - b[1]) * 1.12; if (dx * dx + dy * dy <= b[2] * b[2]) { inside = 1; break; } }
    if (!inside) continue;
    const r = rnd();
    let col;
    if (py > 56) col = r < 0.75 ? '#1d4a24' : '#25562a';
    else if (py > 34) col = r < 0.7 ? '#2f6b31' : (r < 0.9 ? '#25562a' : '#43893c');
    else col = r < 0.55 ? '#43893c' : (r < 0.85 ? '#2f6b31' : '#5aa648');
    g.fillStyle = col; g.fillRect(cx, cy, 4, 4);
  }
  // leaf rim highlights
  g.fillStyle = 'rgba(120,190,96,.5)';
  for (let i = 0; i < 40; i++) { const x = (rnd() * IW) | 0, y = (rnd() * 40) | 0; g.fillRect(x, y, 2, 2); }
}

// dynamic layer = base + the carved hollow
const tun = document.createElement('canvas');
tun.width = IW; tun.height = IH;
const tg = tun.getContext('2d');
function buildTunnel() {
  tg.clearRect(0, 0, IW, IH);
  tg.drawImage(base, 0, 0);
  tg.fillStyle = '#1b1108';
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++)
    if (hollow(x, y)) tg.fillRect(x * T, y * T, T, T);
  // solid dark rim — the cut edge has to read as a recess, not a decal
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++)
    if (!hollow(x, y) && isWood(x, y) && y * T + 2 < GROUND &&
      (hollow(x + 1, y) || hollow(x - 1, y) || hollow(x, y + 1) || hollow(x, y - 1))) {
      tg.fillStyle = 'rgba(10,6,3,0.78)'; tg.fillRect(x * T, y * T, T, T);
    }
  // chewed dither just inside the rim
  tg.fillStyle = 'rgba(48,30,16,0.5)';
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++)
    if (hollow(x, y) &&
      (!hollow(x + 1, y) || !hollow(x - 1, y) || !hollow(x, y + 1) || !hollow(x, y - 1)) &&
      ((x + y) & 1) === 0) tg.fillRect(x * T, y * T, T, T);
  S.dirty = false;
}

// ---------- personalities ----------
const PERSONAS = ['bold', 'timid', 'diligent', 'frugal', 'social'];
const P_HEAD = { bold: '#ff8c1a', timid: '#7d7460', diligent: '#ffe14a', frugal: '#c9a12e', social: '#fff6d0' };
const P_SPEED = { bold: 1.18, timid: 0.88, diligent: 1.0, frugal: 0.95, social: 1.0 };
const JOB_COL = {
  cleaner: '#fff3d6', nurse: '#ffe9a0', builder: '#e8d5a6',
  tender: '#f0c040', forager: '#f6c515', guard: '#e0a010', militia: '#ff8a2b'
};
const JOB_NAME = ['cleaner', 'nurse', 'builder', 'tender', 'forager', 'guard', 'militia'];

function jobOf(b) {
  if (b.role === 'fight') return 'militia';
  if (b.role === 'guard') return 'guard';
  if (b.role === 'forage') return 'forager';
  if (b.age < 1) return 'cleaner';
  if (b.age <= NURSE_HI) return 'nurse';
  if (b.age <= 16) return 'builder';
  return 'tender';
}

// ---------- colony helpers ----------
function spawnWorker(age) {
  const persona = PERSONAS[(rnd() * PERSONAS.length) | 0];
  S.workers.push({
    x: HIVE.x + ri(-8, 8), y: HIVE.y + ri(-8, 8),
    role: 'tend', phase: 'in', path: [], tx: HIVE.x, ty: HIVE.y,
    load: 0, cargo: 'nectar', trip: 0, rt: 0,
    age: age || 0, life: S.season === 2 ? ri(95, 140) : ri(38, 58),
    flap: ri(0, 9), persona: persona, gi: rnd() * 6.28, jx: 0, jy: 0
  });
}
function pop() { return (S.queenAlive ? 1 : 0) + S.workers.length + S.drones.length + countBrood(); }
function countBrood() { let n = 0; for (const c of S.comb) if (c.kind && c.kind !== 'qcell') n++; return n; }
function emptyCells() { let n = 0; for (const c of S.comb) if (!c.kind) n++; return n; }
// Nurses are the young cohort — but autumn "winter bees" are long-lived and
// stay in the rearing crew well past the normal window.
function isNurse(b) {
  return b.age >= NURSE_LO && (b.age <= NURSE_HI || b.age < b.life * 0.55);
}
// Behavioural plasticity. A real colony whose young cohort runs short does not
// simply stop rearing — mature workers revert to feeding, exactly the reflex
// that carries a hive through the spring gap after a broodless winter. Without
// it, countNurses() hits zero once, the queen can never lay again, and the
// colony just ages out even with a full honey house.
function reverts() {
  const young = countNurses();
  if (young >= 2) return 0;
  return Math.max(0, Math.min(S.workers.length - young, 3 - young));
}
function effectiveNurses() { return countNurses() + reverts(); }
function larvaeCap() {
  let soc = 0;
  for (const b of S.workers) if (isNurse(b) && b.persona === 'social') soc++;
  return effectiveNurses() * LARVA_PER_NURSE + soc * 2;
}
// frugal bees eat ~22% less — a colony of frugal foragers outlasts a famine
function maintUnits() {
  let n = S.queenAlive ? 1 : 0;
  for (const b of S.workers) n += (b.persona === 'frugal') ? 0.78 : 1;
  for (const d of S.drones) n += 1;
  return n;
}
function countNurses() { let n = 0; for (const b of S.workers) if (isNurse(b)) n++; return n; }
function countForagers() { let n = 0; for (const b of S.workers) if (b.role === 'forage') n++; return n; }
function countGuards() { let n = 0; for (const b of S.workers) if (b.role === 'guard') n++; return n; }
function countPersona(p) { let n = 0; for (const b of S.workers) if (b.persona === p) n++; return n; }
function seasonOf(d) { return Math.floor((d - 1) / 30) % 4; }

// comb cells are finite: honey and pollen compete for the free ones
function honeyCap() { const free = Math.max(0, emptyCells() - Math.ceil(S.pollen / PPC)); return free * HPC; }
function pollenCap() { const free = Math.max(0, emptyCells() - Math.ceil(S.honey / HPC)); return free * PPC; }

function setBanner(t, hold) { S.banner = t; S.bannerT = hold || 3.4; }
function log(t) { S.logs.unshift(t); if (S.logs.length > 5) S.logs.pop(); }

// ---------- hazards ----------
const HAZ = {
  thunderstorm: { name: 'THUNDERSTORM', days: 1.6 },
  drought: { name: 'DROUGHT', days: 9 },
  heatwave: { name: 'HEATWAVE', days: 5 },
  hornet: { name: 'HORNET RAID', days: 1.3 },
  frost: { name: 'FROST STORM', days: 5 },
  wasps: { name: 'WASP SQUAD', days: 8 },
  bear: { name: 'BEAR ATTACK', days: 12 }
};

/* ---- raids ----------------------------------------------------------
   A hornet squad, a wasp army or a bear does not just "resolve" — it shows
   up on screen, the colony arms itself and fights it. Bold and diligent
   bees volunteer first, timid ones hang back, and every defender can dodge.
   Win fast and the entrance holds; lose the clock and they get inside. */
const RAID = {
  hornet: {
    name: 'HORNET RAID', days: 7, count: 3, hp: 55, cool: 1.4, hits: 1, dps: 6.5,
    sprite: 'hornet', spawn: { x: 256, y: 126 }, spread: { x: 18, y: 24 },
    call: 'Hornets at the fissure — the colony arms itself'
  },
  wasps: {
    name: 'WASP SQUAD', days: 8, count: 4, hp: 45, cool: 1.3, hits: 1, dps: 6.5,
    sprite: 'hornet', spawn: { x: 258, y: 122 }, spread: { x: 24, y: 30 },
    call: 'A squad of wasps masses outside the entrance'
  },
  bear: {
    name: 'BEAR ATTACK', days: 12, count: 1, hp: 460, cool: 1.6, hits: 4, dps: 6.5,
    sprite: 'bear', spawn: { x: 252, y: 140 }, spread: { x: 0, y: 0 },
    call: 'A bear rears up against the trunk'
  }
};
function startRaid(k) {
  const c = RAID[k], mobs = [];
  for (let i = 0; i < c.count; i++) {
    const bx = c.spawn.x + (c.count > 1 ? ri(-c.spread.x, c.spread.x) : 0);
    const by = c.spawn.y + (c.count > 1 ? ri(-c.spread.y, c.spread.y) : 0);
    mobs.push({ id: i, bx: bx, by: by, x: bx, y: by, hp: c.hp, maxHp: c.hp, cool: 0.5 + rnd(), hit: 0 });
  }
  S.raid = { kind: k, name: c.name, days: c.days, mobs: mobs, kills: 0, lost: 0, sparks: [], seen: false };
  log(c.call);
}
function nearestMob(b) {
  if (!S.raid) return null;
  let best = null, bd = 1e9;
  for (const m of S.raid.mobs) { const d = Math.hypot(m.x - b.x, m.y - b.y); if (d < bd) { bd = d; best = m; } }
  return best;
}
function spark(x, y, col) { if (S.raid) S.raid.sparks.push({ x: x, y: y, t: 0.6, col: col || '#ff6a4a' }); }

function updateRaid(dt) {
  const R = S.raid, c = RAID[R.kind];
  R.days -= dt;
  for (const s of R.sparks) s.t -= dt;
  R.sparks = R.sparks.filter(s => s.t > 0);

  // attacker: hovers (wasp) or lumbers against the bark (bear)
  for (const m of R.mobs) {
    const b = c.sprite === 'bear' ? 2 : 7;
    m.x = m.bx + Math.sin(S.frame / 14 + m.id * 2) * b;
    m.y = m.by + Math.cos(S.frame / 11 + m.id * 3) * (c.sprite === 'bear' ? 2 : 5);
    m.cool -= dt; m.hit = Math.max(0, m.hit - dt);
  }

  // the militia closes in and lands hits
  let engaged = 0;
  for (const m of R.mobs) {
    let n = 0;
    for (const b of S.workers) {
      if (b.role !== 'fight') continue;
      if (Math.hypot(b.x - m.x, b.y - m.y) < 15) n++;
    }
    if (n > 0) {
      engaged += n;
      m.hp -= n * c.dps * dt;
      m.hit = 0.12;
      if (rnd() < dt * 8) spark(m.x + ri(-5, 5), m.y + ri(-5, 5), '#ffe08a');
    }
  }
  if (engaged && !R.seen) { R.seen = true; log(engaged + ' defenders swarm the attackers'); }

  // attacker strikes back: reads the swing and can be dodged
  for (const m of R.mobs) {
    if (m.hp <= 0 || m.cool > 0) continue;
    const near = [];
    let cloud = 0;
    for (const b of S.workers) {
      if (b.role !== 'fight') continue;
      const d = Math.hypot(b.x - m.x, b.y - m.y);
      if (d < 17) near.push(b);
      if (d < 34) cloud++;                 // the swarm around it, not just on it
    }
    // the more bees in the air, the less often the attacker gets a free swing
    m.cool = c.cool * (1 + Math.min(8, cloud) * 0.25);
    if (!near.length) continue;
    let hits = c.hits;
    while (hits-- > 0 && near.length) {
      const b = near.splice(ri(0, near.length - 1), 1)[0];
      const dodge = b.persona === 'bold' ? 0.55
        : b.persona === 'diligent' ? 0.40
        : b.persona === 'timid' ? 0.05
        : 0.30;
      if (rnd() < dodge) { spark(b.x, b.y, '#8ff0ff'); continue; }
      const j = S.workers.indexOf(b);
      if (j >= 0) { S.workers.splice(j, 1); R.lost++; spark(b.x, b.y, '#ff4a3d'); }
    }
  }

  // casualties on the attacker side
  for (const m of R.mobs) if (m.hp <= 0) {
    R.kills++; spark(m.x, m.y, '#ffd24a'); spark(m.x + 4, m.y - 3, '#ffd24a');
  }
  const alive = R.mobs.filter(m => m.hp > 0);
  if (alive.length !== R.mobs.length) R.mobs = alive;
  if (!R.mobs.length) { endRaid(true); return; }
  if (R.days <= 0 || S.workers.length <= 4) endRaid(false);
}

function endRaid(won) {
  const R = S.raid, c = RAID[R.kind];
  S.raid = null; S.haz = null; S.hazCd = 16 + rnd() * 16;
  // send the militia home through the fissure, never through the bark
  for (const b of S.workers) if (b.role === 'fight') {
    b.role = 'tend'; setPath(b, homePath(b)); b.rt = 1 + rnd() * 2;
  }
  if (won) {
    setBanner('DEFENCE HELD', 4);
    log('Defence held — ' + R.kills + ' attackers down, ' + R.lost + ' defenders lost');
  } else {
    setBanner('NEST BREACHED', 4.5);
    if (c.sprite === 'bear') { killBees(0.18, false, 'The bear tore into the hollow'); destroyComb(0.35); }
    else killBees(0.12, true, R.kills > 0 ? 'They broke through the entrance' : 'No defenders left standing');
    log(R.kills + ' attackers repelled before they got through');
  }
}

// bold bees read weather and stay home; timid ones get caught outside
function killBees(pct, favorBold, msg) {
  const n = Math.max(1, Math.round(S.workers.length * pct));
  let killed = 0, guard = 0;
  while (killed < n && guard++ < 900 && S.workers.length > 1) {
    const i = ri(0, S.workers.length - 1);
    const b = S.workers[i];
    const persona = b.persona;
    if (favorBold && persona === 'bold' && rnd() < 0.6) continue;
    if (favorBold && persona === 'diligent' && rnd() < 0.3) continue;
    if (!favorBold && persona === 'timid' && rnd() < 0.5) continue;
    if (b.role === 'guard' && rnd() < 0.45) continue;   // guards hold the line
    S.workers.splice(i, 1); killed++;
  }
  if (msg) log(msg + ' · −' + killed + ' bees');
  return killed;
}
function destroyComb(pct) {
  const n = Math.round(S.comb.length * pct);
  let gone = 0;
  for (let i = 0; i < n && S.comb.length; i++) {
    const j = ri(0, S.comb.length - 1);
    const c = S.comb.splice(j, 1)[0];
    S.free.push(c.slot);
    if (S.queenCell === c) S.queenCell = null;
    gone++;
  }
  if (gone) log('Comb torn open · ' + gone + ' cells destroyed');
}
function triggerHaz(k) {
  if (S.haz || S.over) return;
  const p = HAZ[k];
  if (!p) { log('no such hazard: ' + k); return; }
  S.haz = { kind: k, name: p.name, days: p.days };
  setBanner(p.name, 4.5);
  if (RAID[k]) { startRaid(k); return; }
  if (k === 'thunderstorm') {
    killBees(0.10, true, 'Gust front — foragers lost in the wind');
  } else if (k === 'drought') {
    log('Ground dried up — blossoms are giving nothing');
  } else if (k === 'heatwave') {
    log('Heatwave — workers fanning the hollow instead of foraging');
  } else if (k === 'frost') {
    log('Frost — colony clusters and burns stores to stay warm');
  }
}
function rollHaz() {
  const s = S.season, pool = [];
  const add = (k, w) => { for (let i = 0; i < w; i++) pool.push(k); };
  add('thunderstorm', (s === 0 || s === 1) ? 3 : 1);
  add('drought', s === 1 ? 4 : (s === 0 ? 1 : 0));
  add('heatwave', s === 1 ? 3 : (s === 2 ? 1 : 0));
  add('hornet', s === 2 ? 4 : (s === 1 ? 2 : 1));
  add('wasps', s === 1 ? 3 : (s === 2 ? 3 : 1));
  add('frost', s === 3 ? 5 : 0);
  add('bear', 1);
  if (!pool.length || rnd() > 0.55) return;
  triggerHaz(pool[(rnd() * pool.length) | 0]);
}

// ---------- setup ----------
function initHive() {
  for (let i = 0; i < COLS * ROWS; i++) {
    const cx = i % COLS, cy = (i / COLS) | 0;
    solid[i] = isWood(cx, cy) ? 1 : 0;
  }
  S.day = 1; S.year = 1; S.season = 0; S.over = false;
  S.honey = 70; S.pollen = 8;
  S.workers = []; S.drones = []; S.comb = []; S.flowers = [];
  S.slotIdx = 0; S.free = []; S.queenAlive = true; S.queenCell = null; S.queenT = 0;
  S.layT = 0; S.buildT = 0; S.starveT = 0; S.roleT = 0; S.miteYear = -1;
  S.swarmT = 0; S.logs = []; S.banner = null; S.bannerT = 0;
  S.haz = null; S.hazCd = 24; S.raid = null;
  // the hollow a founding swarm moved into: a chamber low in the trunk
  disc(HIVE.x, HIVE.y, 34);
  slotRect(POKE.x - 8, 135, ENT.x + 4, 145);       // entrance fissure
  disc(ENT.x, ENT.y, 8);                            // hole through the bark
  for (let i = 0; i < 6; i++) addComb();
  const seedAges = [24, 27, 19, 22, 31, 17, 12, 8, 5, 3, 1, 0, 9, 6];
  for (let i = 0; i < seedAges.length; i++) spawnWorker(seedAges[i] + ri(0, 3));
  syncFlowers();
  log('Swarm settles in the hollow · 14 workers, 6 cells');
  document.getElementById('over').classList.add('hide');
}

function syncFlowers() {
  const want = FLOWERS[S.season];
  while (S.flowers.length < want) S.flowers.push({ x: ri(6, IW - 6), n: 9, p: 7, i: ri(0, 4) });
  if (S.flowers.length > want) S.flowers.length = want;
}

// ---------- movement ----------
function step(b, tx, ty, sp, dtSec) {
  const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
  const mv = Math.min(d, sp * dtSec);
  b.x += dx / d * mv; b.y += dy / d * mv;
  return d <= sp * dtSec + 1.2;
}
function setPath(b, pts) { b.path = pts.slice(); advance(b); }
function advance(b) { b.tx = b.path[0]; b.ty = b.path[1]; b.path.splice(0, 2); }
// follow a queue of waypoints; true only when the last one is reached
function stepPath(b, sp, ds) {
  const done = step(b, b.tx, b.ty, sp, ds);
  if (!done) return false;
  if (b.path.length >= 2) { advance(b); return false; }
  return true;
}
function pickAirTarget(b) {
  for (let i = 0; i < 60; i++) {
    const cx = ri(2, COLS - 3), cy = ri(1, ROWS - 2);
    if (hollow(cx, cy)) { b.tx = cx * T + 2; b.ty = cy * T + 2; b.rt = 1 + rnd() * 2; return; }
  }
  b.tx = HIVE.x + ri(-10, 10); b.ty = HIVE.y + ri(-10, 10); b.rt = 1;
}
// each bee keeps her own lane through the entrance so the traffic spreads out
function exitPath(b, dest) {
  return [POKE.x, POKE.y, ENT.x, ENT.y, OUT.x + b.jx, OUT.y + b.jy, dest.x, dest.y];
}
function homePath(b) {
  return [OUT.x + b.jx, OUT.y + b.jy, ENT.x, ENT.y, POKE.x, POKE.y, HIVE.x, HIVE.y];
}
function pickFlower(b) {
  b.jx = Math.sin(b.gi) * 7;
  b.jy = Math.cos(b.gi) * 5;
  let pool = S.flowers.filter(f => (b.cargo === 'pollen' ? f.p > 1.5 : f.n > 1.5));
  if (!pool.length) {                 // blossom stripped of that resource — switch
    b.cargo = b.cargo === 'pollen' ? 'nectar' : 'pollen';
    pool = S.flowers.filter(f => (b.cargo === 'pollen' ? f.p > 1.5 : f.n > 1.5));
  }
  let best = null;
  if (pool.length) {
    // everyone aiming at the single nearest blossom makes one clumped smear of
    // traffic — take a random one from the reasonably-near set instead
    let bd = 1e9;
    for (const f of pool) bd = Math.min(bd, Math.abs(f.x - b.x));
    const near = pool.filter(f => Math.abs(f.x - b.x) <= bd + 70);
    best = near[(rnd() * near.length) | 0];
  }
  if (best) { b.f = best; b.phase = 'out'; b.load = 0; setPath(b, exitPath(b, { x: best.x, y: GROUND - 5 })); }
  else { b.f = null; b.phase = 'return'; setPath(b, homePath(b)); }
}
// real foragers collect what the colony is short of, not a fixed ratio
function pollenTarget() {
  let larvae = 0; for (const c of S.comb) if (c.kind === 'larva') larvae++;
  return 30 + larvae * 2.5;
}
function nextTrip(b) {
  // Foragers split the load by need: protein whenever the store is not yet
  // topped up, nectar whenever honey is about to run out. Both gates are
  // live at once so neither store can deadlock the other — a colony that
  // only hauls nectar never breeds, one that only hauls pollen starves.
  const wantPollen = S.pollen < pollenTarget();
  const wantNectar = S.honey < Math.max(70, ORDERS.winterReserve * 0.17);
  if (wantPollen && wantNectar) { b.trip++; b.cargo = (b.trip % 2) ? 'nectar' : 'pollen'; }
  else b.cargo = wantPollen ? 'pollen' : 'nectar';
  b.phase = 'out';
  pickFlower(b);
}

// ---------- update (dt = sim days, ds = scaled seconds) ----------
function update(dt, ds) {
  const seas = seasonOf(S.day);
  if (seas !== S.season) { S.season = seas; onSeason(seas); }
  S.year = Math.floor((S.day - 1) / 120) + 1;

  // ===================== HAZARDS =====================
  if (S.raid) {
    updateRaid(dt);
  } else if (S.haz) {
    S.haz.days -= dt;
    if (S.haz.days <= 0) { log(S.haz.name + ' has passed'); S.haz = null; S.hazCd = 16 + rnd() * 16; }
  } else {
    S.hazCd -= dt;
    if (S.hazCd <= 0) { S.hazCd = 16 + rnd() * 16; rollHaz(); }
  }
  const kind = S.haz ? S.haz.kind : null;
  const drought = kind === 'drought', heat = kind === 'heatwave', frost = kind === 'frost';
  const stormy = kind === 'thunderstorm';

  // --- flowers regrow (a drought stops them dead) ---
  const regenN = drought ? 0.3 : 1, regenP = frost ? 0 : 1;
  for (const f of S.flowers) {
    f.n = Math.min(12, f.n + dt * 8 * regenN);
    f.p = Math.min(10, f.p + dt * 6 * regenP);
  }
  syncFlowers();

  // --- adults run on honey (carbohydrate); fanning and shivering cost extra ---
  const burn = (seas === 3 ? 0.12 : 0.10) * (heat ? 1.6 : frost ? 1.8 : 1);
  const need = maintUnits() * burn;
  S.honey = Math.max(0, S.honey - need * dt);

  const cap = larvaeCap();
  const broodEat = heat ? 1.6 : 1;          // larvae need more water/food in heat

  // ===================== BROOD =====================
  let fed = 0;
  for (const c of S.comb) {
    if (!c.kind) continue;
    if (c.kind === 'egg') {
      c.t += dt;
      if (c.t >= EGG_D) { c.kind = 'larva'; c.t = 0; c.stall = 0; }
    } else if (c.kind === 'larva') {
      // larvae are the only stage that eats — and they need pollen (protein)
      if (fed < cap && S.pollen > 0.01 && S.honey > 0.01) {
        S.pollen = Math.max(0, S.pollen - LARVA_POLLEN_D * dt);
        S.honey = Math.max(0, S.honey - LARVA_HONEY_D * broodEat * dt);
        c.t += dt * (heat ? 0.7 : 1); c.stall = 0; fed++;
        if (c.t >= LARVA_D) { c.kind = 'pupa'; c.t = 0; }
      } else {
        c.stall += dt;
        if (c.stall > STALL_MAX) { c.kind = null; c.t = 0; c.stall = 0; }
      }
    } else if (c.kind === 'pupa') {
      // sealed pupae eat nothing — they survive even a starved colony
      c.t += dt;
      if (c.t >= PUPA_D) { c.kind = null; c.t = 0; spawnWorker(0); }
    }
  }

  // ===================== REQUEENING =====================
  if (!S.queenAlive && !S.queenCell) {
    const cand = S.comb.find(c => c.kind === 'larva' && c.t < 1.6);
    if (cand && effectiveNurses() >= 5 && S.honey > 25 && S.pollen > 8) {
      cand.kind = 'qcell'; cand.t = 0; cand.stall = 0; S.queenCell = cand;
      setBanner('EMERGENCY QUEEN CELL', 4.5);
      log('Workers pick a young larva and flood it with royal jelly');
    }
  }
  if (S.queenCell) {
    const c = S.queenCell;
    if (effectiveNurses() >= 3 && S.honey > 0.01 && S.pollen > 0.01) {
      S.honey = Math.max(0, S.honey - 0.55 * dt);
      S.pollen = Math.max(0, S.pollen - 0.30 * dt);
      c.t += dt; c.stall = 0;
      if (c.t >= QCELL_D) {
        c.kind = null; c.t = 0; S.queenCell = null; S.queenAlive = true; S.queenT = 0;
        setBanner('NEW QUEEN', 4.5); log('New queen emerged — colony recovered');
      }
    } else {
      c.stall += dt;
      if (c.stall > 3) { c.kind = null; c.t = 0; S.queenCell = null; log('Royal cell failed — nothing to feed it'); }
    }
  }

  // ===================== QUEEN LAYS =====================
  // winter lays too — the colony stays equal to every other season,
  // it just refuses to breed into a shrinking honey reserve.
  const reserveGate = seas === 3 ? ORDERS.winterReserve * 0.30 : 0;
  // under siege the queen holds off: every egg laid now is honey the
  // defenders cannot afford while the forage crew is thin.
  const siegeGate = S.raid ? 45 : 18;
  const targetBrood = S.raid ? Math.min(16, countBrood())
    : Math.max(16, Math.floor(S.workers.length * (0.55 + ORDERS.broodPriority * 0.85)));
  const canLay = S.queenAlive && !S.queenCell &&
    S.honey > Math.max(siegeGate, reserveGate) && S.pollen > 6 &&
    S.workers.length > 0 && effectiveNurses() >= 2;
  if (canLay) {
    const rate = LAYRATE[seas];
    const room = Math.min(emptyCells(), Math.max(0, targetBrood - countBrood()));
    S.layT -= dt;
    if (S.layT <= 0) {
      if (room > 0) {
        const c = S.comb.find(x => !x.kind);
        if (c) { c.kind = 'egg'; c.t = 0; c.stall = 0; S.honey = Math.max(0, S.honey - 2); }
      }
      S.layT = 1 / rate;
    }
  } else S.layT = Math.max(S.layT, 0.1);

  // ===================== BUILD COMB =====================
  if (ORDERS.allowBuild) {
    const target = Math.min(SLOTS.length, Math.max(22, Math.floor(pop() * 1.3) + 14));
    const floor = seas === 3 ? Math.max(35, ORDERS.winterReserve * 0.30) : 22;
    S.buildT -= dt;
    if (S.comb.length < target && S.honey > floor && S.buildT <= 0) { addComb(); S.honey = Math.max(0, S.honey - 1); S.buildT = 0.28; }
  }

  // ===================== DRONES =====================
  // colonies raise drones in spring/summer and evict them in autumn
  const wantD = (seas === 0 || seas === 1) && S.workers.length > 26
    ? Math.min(16, Math.floor(S.workers.length * 0.12)) : 0;
  while (S.drones.length < wantD) S.drones.push({ x: HIVE.x + ri(-9, 9), y: HIVE.y + ri(-7, 7), tx: HIVE.x, ty: HIVE.y, rt: 0 });
  while (S.drones.length > wantD) S.drones.pop();

  // ===================== ROLES =====================
  S.roleT -= dt;
  if (S.roleT <= 0) { assignRoles(); S.roleT = 0.4; }

  // ===================== BEES =====================
  for (const b of S.workers) {
    b.age += dt;
    if (b.age > b.life) { b.dead = true; continue; }
    b.flap = (b.flap + 1) % 10;
    const sp = (b.role === 'tend' ? 11 : 48) * (P_SPEED[b.persona] || 1) * (stormy ? 0.8 : 1);

    if (b.role === 'guard') {
      const gx = OUT.x - 8 + Math.sin(S.frame / 22 + b.gi) * 3;
      const gy = OUT.y + Math.cos(S.frame / 18 + b.gi) * 4;
      step(b, gx, gy, 9, ds);
    } else if (b.role === 'fight') {
      // sortie out through the fissure, then close on the attacker
      if (b.path && b.path.length >= 2) stepPath(b, sp, ds);
      else {
        const m = nearestMob(b);
        const tx = (m ? m.x : OUT.x) + Math.sin(S.frame / 7 + b.gi) * 6;
        const ty = (m ? m.y : OUT.y) + Math.cos(S.frame / 6 + b.gi) * 6;
        step(b, tx, ty, sp * 0.5, ds);
      }
    } else if (b.role === 'tend') {
      // a returning fighter walks her waypoint queue home instead of
      // beelining through the bark
      if (b.path && b.path.length >= 2) stepPath(b, sp, ds);
      else {
        b.rt -= dt;
        if (b.rt <= 0) pickAirTarget(b);
        step(b, b.tx, b.ty, sp, ds);
      }
    } else {
      // forager: walk the waypoint queue out through the fissure and back
      if (stepPath(b, sp, ds)) {
        if (b.phase === 'out') {
          const f = b.f;
          if (b.cargo === 'pollen') b.load = (f && f.p > 1.5) ? (f.p -= 6, Math.round(7 * YIELD[S.season])) : 1;
          else b.load = (f && f.n > 1.5) ? (f.n -= 6, Math.round(10 * YIELD[S.season])) : 2;
          b.phase = 'return';
          setPath(b, homePath(b));
        } else {
          if (b.cargo === 'pollen') S.pollen = Math.min(S.pollen + b.load, pollenCap());
          else S.honey = Math.min(S.honey + b.load, honeyCap());
          b.load = 0;
          b.rt = 0; nextTrip(b);
          if (b.phase !== 'out') { b.role = 'tend'; pickAirTarget(b); }
        }
      }
    }
  }
  if (S.workers.some(b => b.dead)) S.workers = S.workers.filter(b => !b.dead);

  for (const d of S.drones) {
    d.rt -= dt;
    if (d.rt <= 0) { d.tx = HIVE.x + ri(-11, 11); d.ty = HIVE.y + ri(-9, 9); d.rt = 1 + rnd() * 2; }
    step(d, d.tx, d.ty, 8, ds);
  }

  // ===================== STARVATION =====================
  if (S.honey <= 0) {
    S.starveT += dt;
    if (S.starveT > 0.16 && S.workers.length > 0) {
      S.starveT = 0;
      S.workers.splice(ri(0, S.workers.length - 1), 1);
      if (S.logs[0] !== 'Honey store empty — bees dying') log('Honey store empty — bees dying');
    }
  } else S.starveT = 0;

  // a queen nobody can feed dies within days
  if (S.workers.length === 0) {
    S.queenT += dt;
    if (S.queenT > 2.5 && S.queenAlive) { S.queenAlive = false; S.queenT = 0; log('Queen starved — no workers left to feed her'); }
  } else S.queenT = 0;

  if (S.workers.length === 0 && countBrood() === 0 && !S.queenCell && !S.queenAlive)
    fail('Colony lost — no queen, no brood, no workers.');

  // ===================== SWARM =====================
  if (ORDERS.allowSwarm && !S.over) {
    S.swarmT -= dt;
    if (S.swarmT <= 0) {
      S.swarmT = 8;
      if (S.workers.length > 170) {
        const half = Math.floor(S.workers.length / 2);
        S.workers.splice(0, half);
        S.comb.forEach(c => { if (c.kind === 'egg' || c.kind === 'larva') c.kind = null; });
        setBanner('PRIME SWARM', 4);
        log('Swarm left — half the colony gone, brood left behind');
      }
    }
  }
}

// age polyethism: young bees work inside, only mature bees fly.
// bold bees volunteer as guards; timid ones refuse the gate.
function countFighters() { let n = 0; for (const b of S.workers) if (b.role === 'fight') n++; return n; }

function assignRoles() {
  const raiding = !!S.raid;
  const eligible = S.workers.filter(b => b.age >= FORAGE_AGE).length;
  // a small colony cannot afford two bees standing on the porch — and during
  // a raid nobody stays on the porch, they all go out to fight.
  const wantG = raiding ? 0
    : S.haz && S.haz.kind === 'hornet' ? 5
    : eligible >= 14 ? 2 : eligible >= 6 ? 1 : 0;
  let haveG = countGuards();
  for (const b of S.workers) {
    const canFly = b.age >= FORAGE_AGE;
    if (haveG < wantG && b.role !== 'guard' && canFly && b.persona !== 'timid') { b.role = 'guard'; b.load = 0; haveG++; }
    else if ((haveG > wantG || !canFly) && b.role === 'guard') {
      b.role = 'tend';
      if (b.x > 195) setPath(b, homePath(b)); else { b.path = []; pickAirTarget(b); }
      b.rt = 1; haveG--;
    }
  }

  // ---- the militia: bold and diligent volunteer first, timid ones never do ----
  // even under attack a few foragers keep flying — a colony that stops
  // feeding the larvae for three days starves behind the winning fight.
  const mature = S.workers.filter(b => b.age >= FORAGE_AGE);
  const reserve = raiding ? Math.min(6, Math.floor(eligible * 0.25)) : 0;
  const wantF = raiding ? Math.max(0, Math.min(mature.length - reserve, 16)) : 0;
  let haveF = countFighters();
  if (haveF < wantF) {
    const pref = { bold: 0, diligent: 1, social: 2, frugal: 3, timid: 4 };
    const pool = mature.filter(b => b.role !== 'fight').sort((a, c) => pref[a.persona] - pref[c.persona]);
    for (const b of pool) {
      if (haveF >= wantF) break;
      b.role = 'fight'; b.load = 0; haveF++;
      setPath(b, exitPath(b, { x: OUT.x, y: OUT.y }));
    }
  } else if (haveF > wantF) {
    for (const b of S.workers) {
      if (haveF <= wantF) break;
      if (b.role !== 'fight') continue;
      b.role = 'tend'; setPath(b, homePath(b)); b.rt = 1 + rnd() * 2; haveF--;
    }
  }

  const want = Math.max(reserve,
    Math.min(Math.round(eligible * ORDERS.forageRatio) - haveG - haveF, S.flowers.length * 3));
  let have = countForagers();
  for (const b of S.workers) {
    const canFly = b.age >= FORAGE_AGE && b.role !== 'guard' && b.role !== 'fight';
    const stormShy = stormActive() && b.persona === 'timid';
    if (have < want && b.role !== 'forage' && canFly && !stormShy) { b.role = 'forage'; b.trip = 0; nextTrip(b); have++; }
    else if ((have > want || !canFly || stormShy) && b.role === 'forage') { b.role = 'tend'; b.load = 0; b.rt = 0; b.path = []; pickAirTarget(b); have--; }
  }
}
function stormActive() { return S.haz && (S.haz.kind === 'thunderstorm' || S.haz.kind === 'frost'); }

function onSeason(s) {
  setBanner(SEASON[s], 3.4);
  if (s === 0) log('Spring — nurse bees start rearing brood');
  if (s === 1) log('Nectar flow on — foragers flooding home');
  if (s === 2) {
    log('Autumn — stores must be built now');
    if (S.miteYear !== S.year) {
      S.miteYear = S.year;
      const loss = Math.max(1, Math.round(S.workers.length * 0.18));
      S.workers.splice(0, loss);
      setBanner('VARROA MITE', 4);
      log('Varroa outbreak — ' + loss + ' workers lost');
    }
  }
  if (s === 3) {
    log('Winter — brood continues, frost storms may hit');
    if (S.honey < ORDERS.winterReserve) log('⚠ reserve target missed: ' + ORDERS.winterReserve);
  }
  S.hazCd = Math.min(S.hazCd, 10 + rnd() * 10);
}

function fail(msg) { S.over = true; setBanner('NEST FAILED', 999); document.getElementById('overSub').textContent = msg; document.getElementById('over').classList.remove('hide'); }

// ---------- render ----------
const clouds = [[30, 84], [140, 96], [250, 78], [190, 104]].map(c => ({ x: c[0], y: c[1], w: 26 + (c[0] % 17) }));
function render() {
  S.frame++;
  // sky sits behind everything, up to the grass line
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, '#8fc7ea'); g.addColorStop(1, '#c6e4f7');
  ctx.fillStyle = g; ctx.fillRect(0, 0, IW, GROUND);
  ctx.fillStyle = '#ffe98a'; ctx.beginPath(); ctx.arc(286, 96, 11, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  for (const c of clouds) {
    const x = (c.x + S.frame * 0.04) % (IW + 60) - 30;
    ctx.fillRect(x, c.y, c.w, 5); ctx.fillRect(x + 5, c.y - 4, c.w - 12, 5);
  }

  // weather tint
  if (S.haz) {
    const k = S.haz.kind;
    if (k === 'thunderstorm') ctx.fillStyle = 'rgba(40,54,74,.30)';
    else if (k === 'drought') ctx.fillStyle = 'rgba(224,170,70,.22)';
    else if (k === 'heatwave') ctx.fillStyle = 'rgba(255,120,60,.18)';
    else if (k === 'frost') ctx.fillStyle = 'rgba(180,214,255,.30)';
    else if (k === 'bear') ctx.fillStyle = 'rgba(120,40,40,.35)';
    else if (k === 'hornet' || k === 'wasps') ctx.fillStyle = 'rgba(150,90,20,.22)';
    if (S.haz.kind === 'frost' && S.frame % 3 === 0) ctx.fillStyle = 'rgba(255,255,255,.7)';
    if (S.haz.kind === 'thunderstorm' && S.frame % 9 === 0) ctx.fillStyle = 'rgba(255,255,180,.65)';
    if (k === 'frost' || k === 'thunderstorm') {
      ctx.fillRect(0, 0, IW, GROUND);
      // falling snow / rain
      ctx.fillStyle = k === 'frost' ? 'rgba(255,255,255,.85)' : 'rgba(190,214,240,.75)';
      for (let i = 0; i < 70; i++) {
        const sx = (i * 47 + S.frame * (k === 'frost' ? 1 : 3)) % IW;
        const sy = (i * 29 + S.frame * (k === 'frost' ? 2 : 6)) % GROUND;
        ctx.fillRect(sx, sy, 1, k === 'frost' ? 1 : 2);
      }
    } else ctx.fillRect(0, 0, IW, GROUND);
  }

  if (S.dirty) buildTunnel();
  ctx.drawImage(tun, 0, 0);

  // flowers on the grass
  const pet = ['#ff7fb0', '#ffd24a', '#c79bff', '#ff9d5c', '#7fe0ff'];
  for (const f of S.flowers) {
    const x = Math.round(f.x);
    ctx.fillStyle = '#3f7a34'; ctx.fillRect(x, GROUND - 6, 1, 7);
    ctx.fillStyle = pet[f.i];
    ctx.fillRect(x - 1, GROUND - 8, 3, 2); ctx.fillRect(x, GROUND - 9, 1, 4);
    if (f.n < 3 && f.p < 3) { ctx.fillStyle = 'rgba(120,140,110,.5)'; ctx.fillRect(x - 1, GROUND - 8, 3, 2); }
  }

  // comb — honey and pollen compete for the free cells
  const avail = emptyCells();
  let hSlots = Math.min(avail, Math.ceil(S.honey / HPC));
  let pSlots = Math.min(avail - hSlots, Math.ceil(S.pollen / PPC));
  for (const c of S.comb) {
    const x = Math.round(c.x), y = Math.round(c.y);
    let col = '#57452e', inner = null, big = false;
    if (c.kind === 'egg') { col = '#efe7d0'; inner = '#b9ad86'; }
    else if (c.kind === 'larva') { col = '#f7e9c6'; inner = c.stall > 1.2 ? '#c06a5a' : '#d3bf90'; }
    else if (c.kind === 'pupa') { col = '#e5ad2e'; inner = '#8a5f10'; }
    else if (c.kind === 'qcell') { col = '#ffd24a'; inner = '#8a5f10'; big = true; }
    else if (hSlots > 0) { hSlots--; col = '#ffcf33'; inner = '#fff0a8'; }
    else if (pSlots > 0) { pSlots--; col = '#b8651f'; inner = '#6e3208'; }
    hexFill(x, y, big ? 5.4 : 4.15, '#140d07');
    hexFill(x, y, big ? 4.5 : 3.35, col);
    if (inner) { ctx.fillStyle = inner; ctx.fillRect(x - 1, y - 1, 2, 2); }
  }

  // the attackers — drawn first so the militia swarms over them
  if (S.raid) drawRaid();

  // drones
  for (const d of S.drones) { ctx.fillStyle = '#5a4530'; ctx.fillRect(Math.round(d.x) - 1, Math.round(d.y) - 1, 3, 3); }

  // workers — coloured by JOB, accented by PERSONALITY
  for (const b of S.workers) drawBee(b);

  // combat sparks sit on top of everything
  if (S.raid) for (const s of S.raid.sparks) {
    ctx.fillStyle = s.col;
    const q = s.t > 0.35 ? 2 : 1;
    ctx.fillRect(Math.round(s.x), Math.round(s.y), q, q);
    if (q === 2) ctx.fillRect(Math.round(s.x) + 2, Math.round(s.y) - 1, 1, 1);
  }

  // queen
  if (S.queenAlive) {
    const bx = Math.round(HIVE.x + Math.sin(S.frame / 22) * 3), by = Math.round(HIVE.y);
    if (S.frame % 6 < 3) { ctx.fillStyle = '#e9f7ff'; ctx.fillRect(bx - 2, by - 4, 1, 2); ctx.fillRect(bx + 2, by - 4, 1, 2); }
    ctx.fillStyle = '#ffb02e'; ctx.fillRect(bx - 2, by - 3, 5, 7);
    ctx.fillStyle = '#7a4a08'; ctx.fillRect(bx - 2, by, 5, 1); ctx.fillRect(bx - 2, by + 2, 5, 1);
    ctx.fillStyle = '#ffe066'; ctx.fillRect(bx - 1, by - 4, 3, 1);
  }
}

// ---------- raiders ----------
function drawHornet(x, y, m) {
  const flap = S.frame % 6 < 3;
  ctx.fillStyle = '#dff2ff';
  if (flap) { ctx.fillRect(x - 1, y - 5, 3, 2); ctx.fillRect(x + 2, y + 3, 3, 2); }
  else { ctx.fillRect(x - 1, y + 3, 3, 2); ctx.fillRect(x + 2, y - 5, 3, 2); }
  const hit = m.hit > 0;
  // abdomen with dark bands, stinger toward the defenders
  ctx.fillStyle = hit ? '#ffffff' : '#f0a51e';
  ctx.fillRect(x - 2, y - 2, 8, 5);
  ctx.fillStyle = hit ? '#ffffff' : '#231a0d';
  ctx.fillRect(x + 1, y - 2, 2, 5);
  ctx.fillRect(x + 4, y - 1, 1, 3);
  // thorax + head facing the fissure
  ctx.fillStyle = hit ? '#ffffff' : '#d9771a';
  ctx.fillRect(x - 6, y - 2, 4, 5);
  ctx.fillStyle = '#151109';
  ctx.fillRect(x - 7, y - 2, 2, 5);
  ctx.fillStyle = '#ff4a3d'; ctx.fillRect(x - 7, y - 1, 1, 1);
  ctx.fillStyle = '#231a0d'; ctx.fillRect(x - 8, y, 2, 1);   // mandibles
  ctx.fillRect(x - 9, y - 2, 2, 1);                          // antenna
}
function drawBear(x, y, m) {
  const X = Math.round(x + Math.sin(S.frame / 13) * 2), Y = Math.round(y);
  const c = m.hit > 0 ? '#b8825a' : '#6b4526';
  const d = '#4a2f18';
  ctx.fillStyle = c; ctx.fillRect(X - 6, Y - 6, 16, 14);
  ctx.fillStyle = d; ctx.fillRect(X - 6, Y + 3, 16, 5);
  // head, facing the trunk
  ctx.fillStyle = c; ctx.fillRect(X - 13, Y - 10, 9, 9);
  ctx.fillStyle = d; ctx.fillRect(X - 13, Y - 12, 3, 3); ctx.fillRect(X - 6, Y - 12, 3, 3);
  ctx.fillStyle = '#a97c50'; ctx.fillRect(X - 16, Y - 6, 4, 4);
  ctx.fillStyle = '#171009'; ctx.fillRect(X - 16, Y - 5, 2, 2);
  ctx.fillStyle = '#120c06'; ctx.fillRect(X - 11, Y - 8, 2, 2);
  // swiping paw
  const claw = (S.frame % 24 < 12) ? -19 : -15;
  ctx.fillStyle = '#f0ead8';
  ctx.fillRect(X + claw, Y - 3, 3, 1); ctx.fillRect(X + claw, Y, 3, 1); ctx.fillRect(X + claw, Y + 3, 3, 1);
  // legs
  ctx.fillStyle = d; ctx.fillRect(X - 4, Y + 8, 4, 4); ctx.fillRect(X + 6, Y + 8, 4, 4);
}
function drawRaid() {
  const R = S.raid, bear = RAID[R.kind].sprite === 'bear';
  for (const m of R.mobs) {
    const x = Math.round(m.x), y = Math.round(m.y);
    if (bear) drawBear(x, y, m); else drawHornet(x, y, m);
    // stamina bar, tight against the attacker's outline
    const w = bear ? 30 : 18, p = Math.max(0, m.hp / m.maxHp);
    const by = bear ? y - 17 : y - 9;
    ctx.fillStyle = '#170d05'; ctx.fillRect(x - (w >> 1) - 1, by, w + 2, 5);
    ctx.fillStyle = p > 0.5 ? '#c6ff00' : p > 0.25 ? '#ffd24a' : '#ff5a4a';
    ctx.fillRect(x - (w >> 1), by + 1, Math.max(1, Math.round(w * p)), 3);
  }
}

function drawBee(b) {
  const x = Math.round(b.x), y = Math.round(b.y);
  const job = jobOf(b);
  const body = JOB_COL[job];
  const small = b.persona === 'frugal';
  const w = small ? 2 : 3, h = small ? 2 : 3;
  const indoor = job === 'cleaner' || job === 'nurse' || job === 'builder' || job === 'tender';
  // wings: foragers and guards beat hard, nest bees idle
  const flick = indoor ? b.flap < 3 : b.flap < 5;
  if (flick) { ctx.fillStyle = '#e9f7ff'; ctx.fillRect(x - 1, y - 2, 1, 1); ctx.fillRect(x + 1, y - 2, 1, 1); }
  ctx.fillStyle = body; ctx.fillRect(x - 1, y - 1, w, h);
  // stripes: flying castes are banded dark, nest castes are banded soft
  const flying = job === 'forager' || job === 'guard' || job === 'militia';
  ctx.fillStyle = flying ? '#221a0d' : '#a8863c';
  if (w === 3) { ctx.fillRect(x, y - 1, 1, 3); if (flying) ctx.fillRect(x + 1, y, 1, 1); }
  else ctx.fillRect(x, y - 1, 1, 2);
  // head carries the personality colour
  ctx.fillStyle = P_HEAD[b.persona]; ctx.fillRect(x - 1, y - 1, 1, 1);
  // fighters helmet up: dark cap with a red crest, so a defender reads at a glance
  if (job === 'militia') { ctx.fillStyle = '#241509'; ctx.fillRect(x - 1, y - 2, w, 1); ctx.fillStyle = '#ff3b2f'; ctx.fillRect(x, y - 2, 1, 1); }
  // load pellet / wax brick
  if (b.load > 0) { ctx.fillStyle = b.cargo === 'pollen' ? '#e8963c' : '#ffd76a'; ctx.fillRect(x + 1, y + 1, 2, 2); }
  if (job === 'builder' && b.flap < 4) { ctx.fillStyle = '#fff6e0'; ctx.fillRect(x - 2, y, 1, 1); }
}

function hexFill(x, y, r, col) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 6, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
}

// ---------- UI ----------
const $ = id => document.getElementById(id);
function ui() {
  $('dayTxt').textContent = 'DAY ' + Math.floor(S.day);
  $('yearTxt').textContent = 'YEAR ' + S.year;
  $('seasonTxt').textContent = SEASON[S.season];
  $('popTxt').textContent = pop();
  $('wkTxt').textContent = S.workers.length;
  $('grTxt').textContent = countGuards();
  $('nuTxt').textContent = countNurses();
  $('fgTxt').textContent = countForagers();
  $('bdTxt').textContent = countBrood();
  $('hnTxt').textContent = Math.max(0, Math.round(S.honey));
  $('plTxt').textContent = Math.max(0, Math.round(S.pollen));
  $('cbTxt').textContent = S.comb.length;
  $('qName').textContent = ORDERS.queen;
  $('qDoc').textContent = S.raid ? '⚔ ' + S.raid.name + ' — ' + countFighters() + ' defenders'
    : S.haz ? '⚠ ' + S.haz.name : ORDERS.doctrine;
  $('qForage').textContent = Math.round(ORDERS.forageRatio * 100) + '%';
  $('qBrood').textContent = Math.round(ORDERS.broodPriority * 100) + '%';
  $('qRes').textContent = ORDERS.winterReserve;
  $('qSwarm').textContent = ORDERS.allowSwarm ? 'ALLOWED' : 'HOLD';
  $('qState').textContent = !S.queenAlive ? (S.queenCell ? 'REARING' : 'NONE')
    : S.queenCell ? 'LAYING+CELL' : 'LAYING';

  const bn = $('banner');
  if (S.raid) {
    const many = RAID[S.raid.kind].count > 1;
    bn.textContent = S.raid.name + ' · ' + countFighters() + ' FIGHTING'
      + (many ? ' · ' + S.raid.mobs.length + ' LEFT' : '');
    bn.classList.remove('hide');
  } else if (S.bannerT > 0) { bn.textContent = S.banner; bn.classList.remove('hide'); }
  else bn.classList.add('hide');

  $('log').innerHTML = S.logs.map((t, i) => '<div class="' + (i === 0 ? 'new' : '') + '">› ' + t + '</div>').join('');
}

// ---------- orders (queen issues them) ----------
function applyOrder(line) {
  const p = line.trim().toLowerCase().replace(/,/g, '.').split(/\s+/);
  if (!p[0]) return;
  switch (p[0]) {
    case 'forage': case 'forageRatio': ORDERS.forageRatio = clamp01(parseFloat(p[1])); break;
    case 'brood': case 'broodPriority': ORDERS.broodPriority = clamp01(parseFloat(p[1])); break;
    case 'reserve': case 'winterReserve': ORDERS.winterReserve = Math.max(0, parseInt(p[1], 10)); break;
    case 'swarm': ORDERS.allowSwarm = /on|allow|yes|1/.test(p[1] || ''); break;
    case 'build': ORDERS.allowBuild = !/off|no|0/.test(p[1] || ''); break;
    case 'speed': S.speed = Math.max(1, Math.min(10, parseInt(p[1], 10) || 1)); markSpeed(); break;
    case 'pause': S.paused = true; markPause(); break;
    case 'resume': case 'play': S.paused = false; markPause(); break;
    case 'reset': case 'new': initHive(); break;
    case 'haz': case 'hazard':                              // queen may summon a threat (demo)
      if (S.raid) { log('already fighting: ' + S.raid.name); break; }
      S.haz = null; triggerHaz(p[1]); break;
    case 'doctrine': ORDERS.doctrine = line.slice(line.indexOf(' ') + 1).toUpperCase(); break;
    default: log('unknown order: ' + p[0]); return;
  }
  log('QUEEN ORDER · ' + line.trim());
  ui();
}
function clamp01(v) { return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.7; }

// ---------- loop ----------
let last = performance.now();
function loop(now) {
  const dsReal = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.paused && !S.over) {
    const ds = dsReal * S.speed, days = ds * DRAIN;
    S.day += days;
    update(days, ds);
    if (S.bannerT > 0) S.bannerT -= dsReal;
  }
  render(); ui();
  requestAnimationFrame(loop);
}

// ---------- controls ----------
function markSpeed() { document.querySelectorAll('.sp').forEach(b => b.classList.toggle('on', +b.dataset.sp === S.speed)); }
function markPause() { $('btnPause').textContent = S.paused ? '▶' : '⏸'; }
document.querySelectorAll('.sp').forEach(b => b.addEventListener('click', () => { S.speed = +b.dataset.sp; markSpeed(); }));
$('btnPause').addEventListener('click', () => { S.paused = !S.paused; markPause(); });
$('btnNew').addEventListener('click', initHive);
$('btnRetry').addEventListener('click', initHive);
$('cmdForm').addEventListener('submit', e => { e.preventDefault(); applyOrder($('cmd').value); $('cmd').value = ''; });

// pull orders issued by Hermes
fetch('queen-orders.json').then(r => { if (!r.ok) throw 0; return r.json(); })
  .then(j => { Object.assign(ORDERS, j); log('Queen orders received from ' + ORDERS.queen); })
  .catch(() => { log('Running on built-in doctrine'); });

buildBase();
initHive();
S.logs = ['Swarm settles in the hollow · 14 workers, 6 cells'];
// ?start=NN → fast-forward N sim days (demos / screenshots)
if (typeof location !== 'undefined') {
  const m = /[?&]start=(\d+)/.exec(location.search);
  if (m) {
    const target = +m[1];
    let guard = 0;
    while (S.day < target && !S.over && guard++ < 400000) {
      const ds = 0.1, days = ds * DRAIN;
      S.day += days; update(days, ds);
    }
    log('Colony fast-forwarded to day ' + Math.floor(S.day));
  }
  const sp = /[?&]speed=(\d+)/.exec(location.search);
  if (sp) { S.speed = Math.max(1, Math.min(10, +sp[1])); markSpeed(); }
  const h = /[?&]haz=([a-z]+)/.exec(location.search);
  if (h) { S.haz = null; S.raid = null; triggerHaz(h[1]); }   // demo hook overrides any rolled hazard
}
applyOrder('forage ' + ORDERS.forageRatio);
markSpeed(); markPause();
requestAnimationFrame(loop);
