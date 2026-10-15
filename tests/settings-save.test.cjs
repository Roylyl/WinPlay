const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8');
function fixture(){
 const writes=[],events=[],context={Object,Math,Error,validateCloseBehavior(){},videoSize:require('../src/display-settings.cjs').videoSize,displayPixels(){return {width:800,height:600,verified:false}},selectedDisplay:()=>({}),async refreshDisplayCapabilities(){},save(value){writes.push(value)},passiveReconnect:{active:false},nativeTheme:{},running:false,send:(...args)=>events.push(args),command(){},updateTray(){},app:{getLocale:()=> 'zh-CN'}};
 vm.createContext(context);vm.runInContext(source.match(/^const defaults=.+;$/m)[0]+'\nlet displaySaveRevision=0;settings={...defaults,width:4000};',context);
 const body=source.slice(source.indexOf("case 'save':")+12,source.indexOf("\n case 'start':"));
 vm.runInContext('async function change(arg)'+body,context);return {context,writes,events};
}
test('unavailable monitor dimensions do not block unrelated preference or real-time volume changes',async()=>{
 const r=fixture();assert.equal((await r.context.change({mediaVolume:0.4,autoReconnect:true})).ok,true);
 assert.equal(r.context.settings.mediaVolume,0.4);assert.equal(r.context.settings.autoReconnect,true);assert.equal(r.writes.length,1);
});
test('ordinary display changes work without physical dimensions and still validate input',async()=>{
 const r=fixture();assert.equal((await r.context.change({width:1920})).ok,true);assert.equal(r.context.settings.width,1920);
 await assert.rejects(r.context.change({width:1921}),/偶数/);assert.equal(r.writes.length,1);assert.equal(r.context.settings.width,1920);
});
test('a failed settings write cannot change live configuration or apply partial effects',async()=>{
 const r=fixture();r.context.save=()=>{throw Error('disk full')};await assert.rejects(r.context.change({autoReconnect:true,mediaVolume:0.4}),/disk full/);
 assert.equal(r.context.settings.autoReconnect,false);assert.equal(r.context.settings.mediaVolume,1);assert.equal(r.events.length,0);
});
test('strict and native modes recheck the monitor and cannot save unverified pixels',async()=>{
 const r=fixture();let refreshes=0;r.context.refreshDisplayCapabilities=async()=>{refreshes++};
 for(const arg of [{strictPixels:true},{fullScreen:true}])await assert.rejects(r.context.change(arg),e=>e.code==='physical-pixels-unavailable');
 assert.equal(refreshes,2);assert.equal(r.writes.length,0);assert.equal(r.context.settings.strictPixels,false);
 r.context.displayPixels=()=>({width:3840,height:2160,verified:true});
 assert.equal((await r.context.change({width:1280,strictPixels:true})).settings.strictPixels,true);
});
test('selecting an unavailable screen clears and returns normalized exact-mode settings',async()=>{
 const r=fixture();r.context.settings.strictPixels=true;r.context.settings.fullScreen=true;
 const result=await r.context.change({displayId:99});assert.equal(result.settings.strictPixels,false);assert.equal(result.settings.fullScreen,false);
 assert.equal(r.context.settings.strictPixels,false);assert.equal(r.context.settings.fullScreen,false);
});
test('a late exact-mode check cannot override a newer display choice or unrelated audio change',async()=>{
 const r=fixture();let done;r.context.refreshDisplayCapabilities=()=>new Promise(resolve=>{done=resolve});
 r.context.displayPixels=()=>({width:3840,height:2160,verified:true});
 const earlier=r.context.change({width:1280,strictPixels:true});
 await r.context.change({mediaVolume:.4});await r.context.change({width:1920,strictPixels:false});done();
 const result=await earlier;assert.equal(result.code,'display-save-superseded');
 assert.equal(r.context.settings.strictPixels,false);assert.equal(r.context.settings.width,1920);assert.equal(r.context.settings.mediaVolume,.4);
});
