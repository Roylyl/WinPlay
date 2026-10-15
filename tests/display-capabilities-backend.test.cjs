const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8');
function fixture(){
 const displays=[{id:1,label:'Display',bounds:{x:0,y:0,width:1280,height:720},scaleFactor:1.5,internal:true}];
 const writes=[],events=[],context={physicalDisplay:require('../src/display-settings.cjs').physicalDisplay,screen:{getAllDisplays:()=>displays,getPrimaryDisplay:()=>displays[0],dipToScreenRect:(_,r)=>({x:r.x,y:r.y,width:r.width*1.5,height:r.height*1.5})},selectedDisplay:()=>displays[0],settings:{strictPixels:true,fullScreen:true,width:1280,height:720},nativeMonitors:[],save:value=>writes.push(value),log(){},send:(...args)=>events.push(args),async refreshNativeMonitors(){throw Error('monitors unavailable')}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function displayPixels'),source.indexOf('function setVideoPixels')),context);return {context,writes,events};
}
test('failed query returns usable displays, clears precise modes and never labels estimates as physical pixels',async()=>{
 const r=fixture(),result=await r.context.refreshDisplayCapabilities();
 assert.equal(result.ok,true);assert.equal(result.items[0].width,1920);assert.equal(result.items[0].physicalPixelsAvailable,false);
 assert.equal(result.settings.strictPixels,false);assert.equal(result.settings.fullScreen,false);assert.equal(r.writes.length,1);assert.equal(r.events.length,1);
 const second=await r.context.refreshDisplayCapabilities();assert.equal(second.settings.strictPixels,false);assert.equal(r.writes.length,1);
});
test('a successful refresh restores availability without automatically reenabling exact modes',async()=>{
 const r=fixture();await r.context.refreshDisplayCapabilities();
 r.context.refreshNativeMonitors=async()=>{r.context.nativeMonitors=[{x:0,y:0,width:1920,height:1080}]};
 const result=await r.context.refreshDisplayCapabilities();assert.equal(result.items[0].physicalPixelsAvailable,true);
 assert.equal(result.settings.strictPixels,false);assert.equal(result.settings.fullScreen,false);
});
test('a superseded enable request cannot normalize settings or publish a stale capability event',async()=>{
 const r=fixture();const result=await r.context.refreshDisplayCapabilities(()=>false);
 assert.equal(result,undefined);assert.equal(r.writes.length,0);assert.equal(r.events.length,0);
});
