'use strict';
/* HIVE — pixel bee colony sim.
   Strategic layer: Queen Hermes issues orders (queen-orders.json / command bar).
   Biology: real worker caste by age, nurse-fed larvae, separate pollen (protein)
   and honey (carbohydrate) stores, egg→larva→pupa timeline, emergency requeening. */

// ---------- constants ----------
const IW = 320, IH = 200;
const GROUND = 64, T = 4;
const COLS = IW / T, ROWS = IH / T, GROW = GROUND / T;
const DRAIN = 0.35;                 // sim-days per real second at 1×

const HPC = 12;                     // honey units held per comb cell
const PPC = 6;                      // pollen units held per comb cell

const EGG_D = 2.0;                  // days as egg   (real ~3)
const LARVA_D = 4.5;                // days as larva (real ~6)
const PUPA_D = 7.0;                 // days as pupa  (real ~12)
const QCELL_D = 10;                 // days to rear a replacement queen

const NURSE_LO = 1, NURSE_HI = 12;  // ages that feed larvae
const FORAGE_AGE = 17;              // only mature bees can fly out
const LARVA_PER_NURSE = 6;          // larvae one nurse can keep fed
const LARVA_POLLEN_D = 0.70;        // pollen / larva / day (protein)
const LARVA_HONEY_D = 0.45;         // honey  / larva / day (energy)
const STALL_MAX = 2.6;              // days unfed before a larva dies

const FLOWERS = [8, 14, 6, 0];      // spring / summer / autumn / winter
const YIELD = [1, 1.35, 0.6, 0];
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

// ---------- hive geometry ----------
const ENT = { x: 40 * T + 2, y: GROUND };
const HIVE = { x: 40 * T + 2, y: 112 };

// ---------- world state ----------
const S = {
  day: 1, year: 1, season: 0,
  speed: 1, paused: false, over: false,
  honey: 45, pollen: 8,
  workers: [], drones: [], comb: [], flowers: [],
  queenAlive: true, queenCell: null,
  queenT: 0, slotIdx: 0, dirty: true,
  layT: 0, buildT: 0, starveT: 0, roleT: 0, miteYear: -1, swarmT: 0,
  banner: null, bannerT: 0, logs: [], frame: 0
};

// ---------- tile grid ----------
const solid = new Uint8Array(COLS * ROWS);
function air(cx, cy) { return cx >= 0 && cx < COLS && cy >= GROW && cy < ROWS && solid[cy * COLS + cx] === 0; }
function cut(cx, cy) { if (cx >= 0 && cx < COLS && cy >= GROW && cy < ROWS) { if (solid[cy * COLS + cx]) { solid[cy * COLS + cx] = 0; S.dirty = true; } } }
function disc(px, py, r) {
  const cx = px / T, cy = py / T, rt = r / T + 0.4;
  for (let y = Math.floor(cy - rt); y <= cy + rt; y++)
    for (let x = Math.floor(cx - rt); x <= cx + rt; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= rt * rt) cut(x, y);
    }
}
function carveShaft() { for (let y = GROW; y <= 27; y++) cut(40, y); }

// comb slots — outward spiral from the hive centre
const SLOTS = (function () {
  const a = [], n = 15, c = n;
  for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++)
    a.push({ dx, dy, r: Math.hypot(dx, dy) });
  a.sort((p, q) => p.r - q.r);
  return a;
})();

function addComb() {
  if (S.slotIdx >= SLOTS.length) return false;
  const s = SLOTS[S.slotIdx++];
  const x = HIVE.x + s.dx * 7 + (Math.abs(s.dy) % 2 ? 3 : 0);
  const y = HIVE.y + s.dy * 6;
  if (y < GROUND + 10 || y > IH - 6) return addComb();
  disc(x, y, 4.6);
  S.comb.push({ x, y, kind: null, t: 0, stall: 0 });
  return true;
}

// ---------- soil texture ----------
const soil = document.createElement('canvas');
soil.width = IW; soil.height = IH - GROUND;
(function () {
  const g = soil.getContext('2d');
  const img = g.createImageData(soil.width, soil.height), d = img.data;
  const pal = [[201, 179, 136], [176, 151, 108], [224, 205, 165], [150, 126, 88], [194, 171, 129], [210, 188, 145]];
  for (let i = 0; i < d.length; i += 4) {
    let p = pal[(rnd() * pal.length) | 0];
    if (rnd() < 0.09) p = [98, 76, 52];
    if (rnd() < 0.06) p = [238, 222, 188];
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // geological strata
  for (let y = 10; y < soil.height; y += 26) {
    g.fillStyle = 'rgba(84,63,42,0.46)'; g.fillRect(0, y, soil.width, 3);
    g.fillStyle = 'rgba(245,230,200,0.38)'; g.fillRect(0, y + 3, soil.width, 1);
  }
  // scattered stones
  for (let i = 0; i < 190; i++) {
    const x = (rnd() * soil.width) | 0, y = (rnd() * soil.height) | 0, w = 2 + ((rnd() * 4) | 0);
    g.fillStyle = rnd() < 0.5 ? 'rgba(126,104,76,0.95)' : 'rgba(240,224,192,0.92)';
    g.fillRect(x, y, w, w > 3 ? 3 : 2);
  }
})();

// ---------- tunnel layer (soil + grass + carved voids) ----------
const tun = document.createElement('canvas');
tun.width = IW; tun.height = IH;
const tg = tun.getContext('2d');
function buildTunnel() {
  tg.clearRect(0, 0, IW, IH);
  tg.drawImage(soil, 0, GROUND);
  // grass band
  tg.fillStyle = '#69a84e'; tg.fillRect(0, GROUND, IW, 3);
  tg.fillStyle = '#548f3f'; tg.fillRect(0, GROUND + 3, IW, 2);
  tg.fillStyle = '#7cba5e';
  for (let x = 0; x < IW; x += 3) if (rnd() < 0.6) tg.fillRect(x, GROUND - 1, 1, 2);
  // voids
  tg.fillStyle = '#3b2b1c';
  for (let y = GROW; y < ROWS; y++) for (let x = 0; x < COLS; x++)
    if (air(x, y)) tg.fillRect(x * T, y * T, T, T);
  // dithered excavated-earth edge around the voids
  tg.fillStyle = 'rgba(48,33,20,0.32)';
  for (let y = GROW; y < ROWS; y++) for (let x = 0; x < COLS; x++)
    if (!air(x, y) && (air(x + 1, y) || air(x - 1, y) || air(x, y + 1) || air(x, y - 1))
      && ((x + y) & 1) === 0) tg.fillRect(x * T, y * T, T, T);
  S.dirty = false;
}

// ---------- colony helpers ----------
function spawnWorker(age) {
  S.workers.push({
    x: HIVE.x + ri(-8, 8), y: HIVE.y + ri(-8, 8),
    role: 'tend', phase: 'in', tx: HIVE.x, ty: HIVE.y,
    load: 0, cargo: 'nectar', trip: 0, rt: 0,
    age: age || 0, life: S.season === 2 ? ri(95, 140) : ri(38, 58),
    flap: ri(0, 9)
  });
}
function pop() { return (S.queenAlive ? 1 : 0) + S.workers.length + S.drones.length + countBrood(); }
function countBrood() { let n = 0; for (const c of S.comb) if (c.kind && c.kind !== 'qcell') n++; return n; }
function emptyCells() { let n = 0; for (const c of S.comb) if (!c.kind) n++; return n; }
// Nurses are the young cohort — but autumn "winter bees" are long-lived and
// stay in the rearing crew well past the normal window, which is exactly what
// lets a colony start brood again in early spring after a broodless winter.
function isNurse(b) {
  return b.age >= NURSE_LO && (b.age <= NURSE_HI || b.age < b.life * 0.55);
}
function countNurses() { let n = 0; for (const b of S.workers) if (isNurse(b)) n++; return n; }
function countForagers() { let n = 0; for (const b of S.workers) if (b.role === 'forage') n++; return n; }
function seasonOf(d) { return Math.floor((d - 1) / 30) % 4; }

// comb cells are finite: honey and pollen compete for the free ones
function honeyCap() { const free = Math.max(0, emptyCells() - Math.ceil(S.pollen / PPC)); return free * HPC; }
function pollenCap() { const free = Math.max(0, emptyCells() - Math.ceil(S.honey / HPC)); return free * PPC; }

function setBanner(t, hold) { S.banner = t; S.bannerT = hold || 3.4; }
function log(t) { S.logs.unshift(t); if (S.logs.length > 5) S.logs.pop(); }

// ---------- setup ----------
function initHive() {
  for (let i = 0; i < COLS * ROWS; i++) solid[i] = (i / COLS | 0) >= GROW ? 1 : 0;
  S.day = 1; S.year = 1; S.season = 0; S.over = false;
  S.honey = 45; S.pollen = 8;
  S.workers = []; S.drones = []; S.comb = []; S.flowers = [];
  S.slotIdx = 0; S.queenAlive = true; S.queenCell = null; S.queenT = 0;
  S.layT = 0; S.buildT = 0; S.starveT = 0; S.roleT = 0; S.miteYear = -1;
  S.swarmT = 0; S.logs = []; S.banner = null; S.bannerT = 0;
  carveShaft(); disc(HIVE.x, HIVE.y + 4, 7);
  for (let i = 0; i < 6; i++) addComb();
  // a prime swarm leaves with the old queen and mostly mature foragers
  const seedAges = [24, 27, 19, 22, 31, 17, 12, 8, 5, 3, 1, 0, 9, 6];
  for (let i = 0; i < seedAges.length; i++) spawnWorker(seedAges[i] + ri(0, 3));
  syncFlowers();
  log('Swarm settles · 14 workers, 6 cells drawn');
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
function pickAirTarget(b) {
  for (let i = 0; i < 40; i++) {
    const cx = ri(2, COLS - 3), cy = ri(GROW + 1, ROWS - 2);
    if (air(cx, cy)) { b.tx = cx * T + 2; b.ty = cy * T + 2; b.rt = 1 + rnd() * 2; return; }
  }
  b.tx = HIVE.x + ri(-10, 10); b.ty = HIVE.y + ri(-10, 10); b.rt = 1;
}
function pickFlower(b) {
  // foragers aim for a blossom that still has the thing they came for
  let best = null, bd = 1e9;
  for (const f of S.flowers) {
    const ok = b.cargo === 'pollen' ? f.p > 1.5 : f.n > 1.5;
    if (ok) { const d = Math.abs(f.x - b.x); if (d < bd) { bd = d; best = f; } }
  }
  if (best) { b.tx = best.x; b.ty = GROUND - 5; b.load = 0; b.f = best; b.phase = 'out'; }
  else { b.tx = ENT.x; b.ty = GROUND; b.load = 0; b.f = null; b.phase = 'return'; }
}
// real foragers collect what the colony is short of, not a fixed ratio
function pollenTarget() {
  let larvae = 0; for (const c of S.comb) if (c.kind === 'larva') larvae++;
  return 30 + larvae * 2.5;
}
function nextTrip(b) {
  // nectar always wins while the honey reserve is thin — pollen only once
  // the carbohydrate store is safe, exactly how a colony triages its work
  const honeyFloor = Math.max(60, ORDERS.winterReserve * 0.15);
  b.cargo = (S.pollen < pollenTarget() && S.honey >= honeyFloor) ? 'pollen' : 'nectar';
  pickFlower(b);
}

// ---------- update (dt = sim days, ds = scaled seconds) ----------
function update(dt, ds) {
  const seas = seasonOf(S.day);
  if (seas !== S.season) { S.season = seas; onSeason(seas); }
  S.year = Math.floor((S.day - 1) / 120) + 1;

  // --- flowers regrow nectar and pollen ---
  if (seas !== 3) for (const f of S.flowers) { f.n = Math.min(12, f.n + dt * 8); f.p = Math.min(10, f.p + dt * 6); }
  syncFlowers();

  // --- adults run on honey (carbohydrate) ---
  const need = pop() * (seas === 3 ? 0.12 : 0.10);
  S.honey = Math.max(0, S.honey - need * dt);

  const larvaeCap = countNurses() * LARVA_PER_NURSE;

  // ===================== BROOD =====================
  let fed = 0;
  for (const c of S.comb) {
    if (!c.kind) continue;
    if (c.kind === 'egg') {
      c.t += dt;
      if (c.t >= EGG_D) { c.kind = 'larva'; c.t = 0; c.stall = 0; }
    } else if (c.kind === 'larva') {
      // larvae are the only stage that eats — and they need pollen (protein)
      if (fed < larvaeCap && S.pollen > 0.01 && S.honey > 0.01) {
        S.pollen = Math.max(0, S.pollen - LARVA_POLLEN_D * dt);
        S.honey = Math.max(0, S.honey - LARVA_HONEY_D * dt);
        c.t += dt; c.stall = 0; fed++;
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
    if (cand && countNurses() >= 5 && S.honey > 25 && S.pollen > 8) {
      cand.kind = 'qcell'; cand.t = 0; cand.stall = 0; S.queenCell = cand;
      setBanner('EMERGENCY QUEEN CELL', 4.5);
      log('Workers pick a young larva and flood it with royal jelly');
    }
  }
  if (S.queenCell) {
    const c = S.queenCell;
    if (countNurses() >= 3 && S.honey > 0.01 && S.pollen > 0.01) {
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
  const reserveGate = seas === 2 ? ORDERS.winterReserve * 0.6 : 0;
  const targetBrood = Math.floor(S.workers.length * (0.6 + ORDERS.broodPriority));
  const canLay = S.queenAlive && !S.queenCell && seas !== 3 &&
    S.honey > Math.max(7, reserveGate) && S.pollen > 8 &&
    S.workers.length > 0 && countNurses() >= 2;
  if (canLay) {
    const rate = seas === 1 ? 3.4 : seas === 0 ? 2.4 : 1.3;
    const cap = Math.min(emptyCells(), Math.max(0, targetBrood - countBrood()));
    S.layT -= dt;
    if (S.layT <= 0) {
      if (cap > 0) {
        const c = S.comb.find(x => !x.kind);
        if (c) { c.kind = 'egg'; c.t = 0; c.stall = 0; S.honey = Math.max(0, S.honey - 3); }
      }
      S.layT = 1 / rate;
    }
  } else S.layT = Math.max(S.layT, 0.1);

  // ===================== BUILD COMB =====================
  if (ORDERS.allowBuild) {
    const target = Math.min(SLOTS.length, Math.max(24, Math.floor(pop() * 1.5) + 18));
    const floor = seas === 2 ? Math.max(45, ORDERS.winterReserve * 0.35) : 35;
    S.buildT -= dt;
    if (S.comb.length < target && S.honey > floor && S.buildT <= 0) { addComb(); S.honey = Math.max(0, S.honey - 3); S.buildT = 0.16; }
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
    if (b.role === 'tend') {
      b.rt -= dt;
      if (b.rt <= 0) pickAirTarget(b);
      step(b, b.tx, b.ty, 11, ds);
    } else {
      if (b.phase === 'out') {
        if (step(b, b.tx, b.ty, 30, ds)) {
          const f = b.f;
          if (b.cargo === 'pollen') b.load = (f && f.p > 1.5) ? (f.p -= 6, Math.round(7 * YIELD[S.season])) : 1;
          else b.load = (f && f.n > 1.5) ? (f.n -= 6, Math.round(10 * YIELD[S.season])) : 2;
          b.phase = 'return'; b.tx = ENT.x; b.ty = GROUND;
        }
      } else {
        if (step(b, b.tx, b.ty, 30, ds)) {
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
  if (S.honey <= 0 || S.pollen <= 0) {
    S.starveT += dt;
    if (S.starveT > 0.16 && S.workers.length > 0) {
      S.starveT = 0;
      S.workers.splice(ri(0, S.workers.length - 1), 1);
      if (S.logs[0] !== 'Stores empty — bees dying') log('Stores empty — bees dying');
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

// age polyethism: young bees work inside, only mature bees fly
function assignRoles() {
  const eligible = S.workers.filter(b => b.age >= FORAGE_AGE).length;
  const want = S.season === 3 ? 0
    : Math.min(Math.round(eligible * ORDERS.forageRatio), S.flowers.length * 2);
  let have = countForagers();
  for (const b of S.workers) {
    const canFly = b.age >= FORAGE_AGE;
    if (have < want && b.role !== 'forage' && canFly) { b.role = 'forage'; b.trip = 0; nextTrip(b); have++; }
    else if ((have > want || !canFly) && b.role === 'forage') { b.role = 'tend'; b.load = 0; b.rt = 0; pickAirTarget(b); have--; }
  }
}

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
    log('Winter cluster — ' + Math.floor(S.honey) + ' honey, ' + Math.floor(S.pollen) + ' pollen');
    if (S.honey < ORDERS.winterReserve) log('⚠ reserve target missed: ' + ORDERS.winterReserve);
  }
}

function fail(msg) { S.over = true; setBanner('NEST FAILED', 999); document.getElementById('overSub').textContent = msg; document.getElementById('over').classList.remove('hide'); }

// ---------- render ----------
const clouds = [[30, 16], [140, 24], [250, 14], [190, 34]].map(c => ({ x: c[0], y: c[1], w: 26 + (c[0] % 17) }));
function render() {
  S.frame++;
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, '#8fc7ea'); g.addColorStop(1, '#c6e4f7');
  ctx.fillStyle = g; ctx.fillRect(0, 0, IW, GROUND);
  ctx.fillStyle = '#ffe98a'; ctx.beginPath(); ctx.arc(286, 18, 11, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  for (const c of clouds) {
    const x = (c.x + S.frame * 0.04) % (IW + 60) - 30;
    ctx.fillRect(x, c.y, c.w, 5); ctx.fillRect(x + 5, c.y - 4, c.w - 12, 5);
  }
  if (S.dirty) buildTunnel();
  ctx.drawImage(tun, 0, 0);

  // flowers
  const pet = ['#ff7fb0', '#ffd24a', '#c79bff', '#ff9d5c', '#7fe0ff'];
  for (const f of S.flowers) {
    const x = Math.round(f.x);
    ctx.fillStyle = '#3f7a34'; ctx.fillRect(x, GROUND - 5, 1, 6);
    ctx.fillStyle = pet[f.i];
    ctx.fillRect(x - 1, GROUND - 7, 3, 2); ctx.fillRect(x, GROUND - 8, 1, 4);
    if (f.n < 3 && f.p < 3) { ctx.fillStyle = 'rgba(120,140,110,.5)'; ctx.fillRect(x - 1, GROUND - 7, 3, 2); }
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

  // drones
  for (const d of S.drones) { ctx.fillStyle = '#5a4530'; ctx.fillRect(Math.round(d.x) - 1, Math.round(d.y) - 1, 3, 3); }

  // workers
  for (const b of S.workers) {
    const x = Math.round(b.x), y = Math.round(b.y);
    if (b.flap < 5) { ctx.fillStyle = '#e9f7ff'; ctx.fillRect(x - 1, y - 2, 1, 1); ctx.fillRect(x + 1, y - 2, 1, 1); }
    ctx.fillStyle = '#f6c515'; ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.fillStyle = '#221a0d'; ctx.fillRect(x, y - 1, 1, 3); ctx.fillRect(x + 1, y, 1, 1);
    if (b.load > 0) { ctx.fillStyle = b.cargo === 'pollen' ? '#e8963c' : '#ffd76a'; ctx.fillRect(x + 1, y + 1, 2, 2); }
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
  $('nuTxt').textContent = countNurses();
  $('fgTxt').textContent = countForagers();
  $('bdTxt').textContent = countBrood();
  $('hnTxt').textContent = Math.max(0, Math.round(S.honey));
  $('plTxt').textContent = Math.max(0, Math.round(S.pollen));
  $('cbTxt').textContent = S.comb.length;
  $('qName').textContent = ORDERS.queen;
  $('qDoc').textContent = ORDERS.doctrine;
  $('qForage').textContent = Math.round(ORDERS.forageRatio * 100) + '%';
  $('qBrood').textContent = Math.round(ORDERS.broodPriority * 100) + '%';
  $('qRes').textContent = ORDERS.winterReserve;
  $('qSwarm').textContent = ORDERS.allowSwarm ? 'ALLOWED' : 'HOLD';
  $('qState').textContent = !S.queenAlive ? (S.queenCell ? 'REARING' : 'NONE')
    : S.queenCell ? 'LAYING+CELL' : S.season === 3 ? 'CLUSTERED' : 'LAYING';

  const bn = $('banner');
  if (S.bannerT > 0) { bn.textContent = S.banner; bn.classList.remove('hide'); }
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

initHive();
S.logs = ['Swarm settles · 14 workers, 6 cells drawn'];
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
}
applyOrder('forage ' + ORDERS.forageRatio);
markSpeed(); markPause();
requestAnimationFrame(loop);
