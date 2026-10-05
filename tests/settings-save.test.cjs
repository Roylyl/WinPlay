const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8');
function fixture(){
 const writes=[],events=[],context={Object,Math,Error,validateCloseBehavior(){},videoSize(){throw Error('无法读取显示器物理像素')},displayPixels(){return {}},screen:{getAllDisplays:()=>[],getPrimaryDisplay:()=>({})},save(value){writes.push(value)},passiveReconnect:{active:false},nativeTheme:{},running:false,send:(...args)=>events.push(args),command(){},updateTray(){},app:{getLocale:()=> 'zh-CN'}};
 vm.createContext(context);vm.runInContext(source.match(/^const defaults=.+;$/m)[0]+'\nsettings={...defaults,width:4000};',context);
 const body=source.slice(source.indexOf("case 'save':")+12,source.indexOf("\n case 'start':"));
 vm.runInContext('function change(arg)'+body,context);return {context,writes,events};
}
test('unavailable monitor dimensions do not block unrelated preference or real-time volume changes',()=>{
 const r=fixture();assert.equal(r.context.change({mediaVolume:0.4,autoReconnect:true}).ok,true);
 assert.equal(r.context.settings.mediaVolume,0.4);assert.equal(r.context.settings.autoReconnect,true);assert.equal(r.writes.length,1);
});
test('display preference changes still validate physical dimensions before saving',()=>{
 const r=fixture();assert.throws(()=>r.context.change({width:1920}),/无法读取显示器物理像素/);assert.equal(r.writes.length,0);assert.equal(r.context.settings.width,4000);
});
test('a failed settings write cannot change the live configuration or apply partial effects',()=>{
 const r=fixture();r.context.save=()=>{throw Error('disk full')};assert.throws(()=>r.context.change({autoReconnect:true,mediaVolume:0.4}),/disk full/);
 assert.equal(r.context.settings.autoReconnect,false);assert.equal(r.context.settings.mediaVolume,1);assert.equal(r.events.length,0);
});
