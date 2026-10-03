// Headless raid test: summon each attacker, watch the colony mobilise, fight and resolve.
const fs = require('fs');
const vm = require('vm');

const ctx2d = () => ({
  fillStyle: '', imageSmoothingEnabled: false,
  createLinearGradient: () => ({ addColorStop() {} }),
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, drawImage() {}, fillRect() {}, clearRect() {},
  beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, arc() {}, stroke() {},
  save() {}, restore() {}, clip() {}, ellipse() {}
});
const el = () => ({
  textContent: '', innerHTML: '', value: '', dataset: {}, style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() {}
});
const canvasEl = () => ({ width: 0, height: 0, getContext: ctx2d, style: {}, addEventListener() {} });

const sandbox = {
  document: { getElementById: id => (id === 'c' ? canvasEl() : el()), createElement: () => canvasEl(), querySelectorAll: () => [] },
  performance: { now: () => 0 }, requestAnimationFrame: () => 0,
  fetch: () => Promise.reject(new Error('offline')),
  Math, Date, console, Uint8ClampedArray, Uint8Array, Array, isFinite, parseInt, parseFloat
};
sandbox.window = sandbox;
const c = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/app.js', 'utf8'), c, { filename: 'app.js' });

vm.runInContext(`
globalThis.__tick = function (ds) { var days = ds * DRAIN; S.day += days; update(days, ds);
  if (S.bannerT > 0) S.bannerT -= ds; };
globalThis.__state = function () {
  return { raid: S.raid ? S.raid.kind : null, mobs: S.raid ? S.raid.mobs.length : 0,
    mobsHp: S.raid ? Math.round(S.raid.mobs.reduce((a,m)=>a+m.hp,0)) : 0,
    fight: countFighters(), lost: S.raid ? S.raid.lost : 0, kills: S.raid ? S.raid.kills : 0,
    days: S.raid ? Math.round(S.raid.days * 10) / 10 : 0, wk: S.workers.length,
    day: Math.floor(S.day), mature: S.workers.filter(b=>b.age>=17).length,
    honey: Math.round(S.honey), pollen: Math.round(S.pollen), starve: Math.round(S.starveT*100)/100,
    guards: countGuards(), forage: countForagers(), haz: S.haz ? S.haz.kind : null,
    over: S.over, logs: S.logs.slice(0, 4) };
};
`, c);

function tick(ds, n) { for (let i = 0; i < n; i++) vm.runInContext('__tick(' + ds + ')', c); }
function state() { return vm.runInContext('__state()', c); }

let fail = null;
try {
  // grow a colony first — a founding swarm has nobody to mobilise
  tick(0.1, 1300);                      // ≈ 45 sim days — an established colony
  let s = state();
  console.log('GROWN ' + JSON.stringify({ wk: s.wk, haz: s.haz }));

  for (const kind of ['hornet', 'wasps', 'bear']) {
    vm.runInContext('S.haz = null; S.raid = null; triggerHaz(' + JSON.stringify(kind) + ')', c);
    s = state();
    if (s.raid !== kind) { fail = kind + ': raid did not start (' + s.raid + ')'; break; }
    const wk0 = state().wk;
    let peakFight = 0, firstFrame = null, resolved = null, steps = 0, final = null;

    while (steps < 6000) {              // up to ~600 sim days of budget
      const prev = state();
      tick(0.1, 1);
      steps++;
      s = state();
      if (firstFrame === null && s.mobs > 0) firstFrame = { fight: s.fight, mobs: s.mobs, hp: s.mobsHp };
      if (s.fight > peakFight) peakFight = s.fight;
      if (steps % 30 === 0) console.log('    t=' + steps + ' d=' + s.day + ' fight=' + s.fight + ' mobs=' + s.mobs + ' hp=' + s.mobsHp + ' lost=' + s.lost + ' wk=' + s.wk + ' mature=' + s.mature + ' hon=' + s.honey + ' pol=' + s.pollen);
      if (prev.raid && !s.raid) { final = prev; resolved = s; break; }
      if (s.over) { final = prev; resolved = s; break; }
    }
    if (!resolved || !final) { fail = kind + ': raid never resolved'; break; }

    const endLog = state().logs[0] || '';
    tick(0.1, 40);                       // let assignRoles re-staff the forage crew
    s = state();
    console.log(kind.toUpperCase().padEnd(7)
      + ' militia=' + peakFight
      + ' lasted=' + steps + 'ticks'
      + ' attackersKilled=' + final.kills
      + ' defendersLost=' + final.lost
      + ' wk=' + wk0 + '->' + s.wk
      + ' forageBack=' + s.forage
      + ' fightsLeft=' + s.fight
      + ' haz=' + s.haz
      + ' mature=' + s.mature + ' hon=' + s.honey + ' pol=' + s.pollen + ' starve=' + s.starve + ' over=' + s.over);
    console.log('   logs: ' + JSON.stringify(s.logs));

    if (peakFight < 3) { fail = kind + ': colony did not mobilise (' + peakFight + ')'; break; }
    if (s.fight !== 0) { fail = kind + ': militia did not stand down (' + s.fight + ')'; break; }
    if (s.over) { fail = kind + ': colony destroyed by the raid'; break; }
    if (s.haz) { fail = kind + ': hazard never cleared (' + s.haz + ')'; break; }
    vm.runInContext('__tick(0.1)', c);  // let the colony recover between raids
  }
} catch (e) { fail = 'CRASH: ' + e.stack; }

console.log(fail ? 'FAIL ' + fail : 'RAID-OK');
