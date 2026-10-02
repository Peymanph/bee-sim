// Headless test: mirrors loop() — advances day and movement together.
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
globalThis.__tick = function (ds) {
  var days = ds * DRAIN; S.day += days; update(days, ds);
  if (S.bannerT > 0) S.bannerT -= ds;
};
globalThis.__snap = function () {
  return { day: Math.floor(S.day), year: S.year, season: SEASON[S.season],
    pop: pop(), wk: S.workers.length, nurses: countNurses(), foragers: countForagers(),
    brood: countBrood(),
    egg: S.comb.filter(x=>x.kind==='egg').length,
    lar: S.comb.filter(x=>x.kind==='larva').length,
    pup: S.comb.filter(x=>x.kind==='pupa').length,
    cells: S.comb.length, honey: Math.max(0, Math.round(S.honey)),
    pollen: Math.max(0, Math.round(S.pollen)), drones: S.drones.length,
    guards: countGuards(), haz: S.haz ? S.haz.kind : null,
    bold: countPersona('bold'), timid: countPersona('timid'),
    queen: S.queenAlive, qcell: !!S.queenCell, over: S.over };
};
`, c);

let crashed = null, lastDay = -1;
try {
  for (let i = 0; i < 15000; i++) {      // 0.1s steps ≈ 525 sim days at 1x
    vm.runInContext('__tick(0.1)', c);
    if (i % 40 === 0) vm.runInContext('render(); ui();', c);
    const s = vm.runInContext('__snap()', c);
    if (s.day >= lastDay + 45 || s.over) { console.log(JSON.stringify(s)); lastDay = s.day; }
    if (s.over) { console.log('LOGS ' + vm.runInContext('JSON.stringify(S.logs)', c)); break; }
  }
} catch (e) { crashed = e; }
console.log(crashed ? 'CRASH: ' + crashed.stack : 'NO-CRASH');
