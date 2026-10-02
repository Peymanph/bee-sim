const fs=require('fs'), vm=require('vm');
const ctx2d=()=>({fillStyle:'',imageSmoothingEnabled:false,
 createLinearGradient:()=>({addColorStop(){}}),
 createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),
 putImageData(){},drawImage(){},fillRect(){},clearRect(){},
 beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},arc(){},stroke(){},
 save(){},restore(){},clip(){},ellipse(){}});
const el=()=>({textContent:'',innerHTML:'',value:'',dataset:{},style:{},
 classList:{add(){},remove(){},toggle(){},contains(){return false;}},addEventListener(){}});
const canvasEl=()=>({width:0,height:0,getContext:ctx2d,style:{},addEventListener(){}});
const sb={document:{getElementById:id=>(id==='c'?canvasEl():el()),createElement:()=>canvasEl(),querySelectorAll:()=>[]},
 performance:{now:()=>0},requestAnimationFrame:()=>0,fetch:()=>Promise.reject(new Error('x')),
 Math,Date,console,Uint8ClampedArray,Uint8Array,Array,isFinite,parseInt,parseFloat};
sb.window=sb; const c=vm.createContext(sb);
vm.runInContext(fs.readFileSync(__dirname+'/app.js','utf8'),c,{filename:'app.js'});
vm.runInContext(`
globalThis.__tick=function(ds){var days=ds*DRAIN;S.day+=days;update(days,ds);};
globalThis.__probe=function(){
  var inH=0,inP=0,ph={out:0,ret:0},far=0;
  for (const b of S.workers){ if(b.role==='forage'){ ph[b.phase]=(ph[b.phase]||0)+1;
    var d=Math.round(Math.hypot(b.x-ENT.x,b.y-ENT.y)); if(d>60) far++; } }
  return {d:Math.floor(S.day),wk:S.workers.length,fg:countForagers(),gu:countGuards(),
    hon:Math.round(S.honey),pol:Math.round(S.pollen),flow:S.flowers.length,
    fn:Math.round(S.flowers.reduce((a,f)=>a+f.n,0)),fp:Math.round(S.flowers.reduce((a,f)=>a+f.p,0)),
    ph:ph,far:far,
    pos:S.workers.filter(b=>b.role==='forage').slice(0,4).map(b=>Math.round(b.x)+','+Math.round(b.y)),
    cellh:S.comb.filter(x=>x.kind).length,egg:S.comb.filter(x=>x.kind==='egg').length,
    nu:countNurses(),over:S.over};
};
`,c);
for(let i=0;i<2000;i++){ vm.runInContext('__tick(0.1)',c);
 if(i%150===0) console.log(JSON.stringify(vm.runInContext('__probe()',c)));
 if(vm.runInContext('S.over',c)){console.log('OVER '+vm.runInContext('JSON.stringify(S.logs)',c));break;} }
