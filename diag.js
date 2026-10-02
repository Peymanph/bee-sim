// diagnostic run — print colony internals every 2 sim days
const fs = require('fs'), vm = require('vm');
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
globalThis.__tick = function (ds) { var days = ds * DRAIN; S.day += days; update(days, ds); };
globalThis.__diag = function () {
  var ages = S.workers.map(function(b){return Math.round(b.age);}).sort(function(a,b){return a-b;});
  return { d: Math.floor(S.day), wk: S.workers.length, nu: countNurses(), fg: countForagers(),
    gu: countGuards(), elig: S.workers.filter(b=>b.age>=17).length,
    brood: countBrood(), egg: S.comb.filter(x=>x.kind==='egg').length,
    lar: S.comb.filter(x=>x.kind==='larva').length, pup: S.comb.filter(x=>x.kind==='pupa').length,
    honey: Math.round(S.honey), pollen: Math.round(S.pollen), cells: S.comb.length,
    lay: Math.round(S.layT*100)/100, age: ages.join(','), over: S.over };
};
`, c);

let last = -1;
for (let i = 0; i < 15000; i++) {
  vm.runInContext('__tick(0.1)', c);
  const d = vm.runInContext('Math.floor(S.day)', c);
  if (d !== last && d % 15 === 0) {
    last = d;
    console.log(JSON.stringify(vm.runInContext('__diag()', c)));
  }
  if (vm.runInContext('S.over', c)) { console.log('OVER: ' + vm.runInContext('JSON.stringify(S.logs)', c)); break; }
}
