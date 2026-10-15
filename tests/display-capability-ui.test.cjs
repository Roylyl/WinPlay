const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/ui/app.js'),'utf8');
function fixture(){
 const nodes=new Map(),writes=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,checked:false,hidden:false,dataset:{},textContent:''});return nodes.get(id)};
 node('resolutionPreset').options=['native','1280x720','1920x1080','2560x1440','custom'].map(value=>({value,disabled:false}));
 const config={width:1280,height:720,strictPixels:false,fullScreen:false,displayId:1,resolutionMode:'preset'};
 const context={config,$:node,displayItems:[],displayLoading:true,displayRequest:0,displaySaveRequest:0,displayError:'',displayDraft:undefined,resolutionChoice:'preset',pendingSaves:new Set(),t:s=>s,
  literal:(id,value)=>node(id).textContent=value,result:(id,value)=>{node(id).textContent=value;node(id).hidden=!value},
  selected:(select,items,value)=>{select.items=items;select.value=String(value)},
  call:async(op,values)=>{writes.push({op,values});return {ok:true}}
 };
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function currentDisplay('),source.indexOf('async function audioDevices(')),context);
 const item=(id=1,available=true)=>({id,label:'Display '+id,width:1920,height:1080,primary:id===1,physicalPixelsAvailable:available});
 return {context,config,node,writes,item,native:()=>node('resolutionPreset').options[0],apply:(items,settings)=>context.applyDisplayCapabilities({items,settings})};
}
test('exact controls start disabled before the monitor query completes',()=>{
 const html=fs.readFileSync(require.resolve('../src/ui/index.html'),'utf8');
 assert.match(html,/<input id="strictPixels"[^>]+disabled/);assert.match(html,/<option value="native"[^>]+disabled/);
 const r=fixture();r.config.strictPixels=true;r.config.fullScreen=true;r.context.displayLimits();
 assert.equal(r.node('strictPixels').disabled,true);assert.equal(r.node('strictPixels').checked,false);assert.equal(r.native().disabled,true);
 assert.equal(r.node('width').disabled,false);assert.equal(r.node('request-pixels').textContent,'1280×720');assert.equal(r.config.strictPixels,true);
});
test('fallback display estimates cannot enable exact modes or block ordinary sizes',()=>{
 const r=fixture();r.config.strictPixels=true;r.config.fullScreen=true;
 r.apply([{...r.item(1,false),width:800,height:600}],{strictPixels:false,fullScreen:false});
 assert.equal(r.node('strictPixels').disabled,true);assert.equal(r.node('strictPixels').checked,false);assert.equal(r.native().disabled,true);
 assert.equal(r.node('width').disabled,false);assert.equal(r.node('width').max,16384);assert.equal(r.node('resolutionPreset').options.find(o=>o.value==='1920x1080').disabled,false);
 assert.equal(r.context.displayError,'');assert.equal(r.writes.length,0);assert.ok(!r.node('display-limit').textContent.includes('800×600'));assert.ok(!r.node('displayId').items[0].label.includes('800×600'));
});
test('refresh recovery enables exact sizing only for the selected successfully read monitor',()=>{
 const r=fixture();r.apply([r.item(1,false),r.item(2,true)]);assert.equal(r.node('strictPixels').disabled,true);
 r.config.displayId=2;r.context.displayLimits();assert.equal(r.node('strictPixels').disabled,false);assert.equal(r.native().disabled,false);
 r.config.displayId=1;r.apply([r.item(1,true),r.item(2,false)]);assert.equal(r.node('strictPixels').disabled,false);assert.ok(r.node('display-limit').textContent.includes('1920×1080物理像素'));
});
test('query failure invalidates stale capability without rewriting configuration or creating a display validation error',async()=>{
 const r=fixture();r.config.strictPixels=true;r.apply([r.item()]);r.context.call=async()=>{throw Error('IPC unavailable')};
 await r.context.displays();assert.equal(r.node('strictPixels').disabled,true);assert.equal(r.native().disabled,true);assert.equal(r.node('strictPixels').checked,false);
 assert.equal(r.config.strictPixels,true);assert.equal(r.context.displayError,'');assert.equal(r.node('width').disabled,false);
});
test('a completed capability update supersedes an older query still in flight',async()=>{
 const r=fixture();let finish;r.context.call=()=>new Promise(resolve=>finish=resolve);const pending=r.context.displays();
 ++r.context.displayRequest;r.apply([r.item(1,false)],{strictPixels:false,fullScreen:false});finish({ok:true,items:[r.item(1,true)],settings:{strictPixels:true,fullScreen:false}});await pending;
 assert.equal(r.node('strictPixels').disabled,true);assert.equal(r.config.strictPixels,false);
});
test('capability refresh preserves invalid width drafts and their real validation error',()=>{
 const r=fixture();r.context.displayError='Invalid even size';r.context.displayDraft={width:1281,height:720,strictPixels:true};r.node('displayId').value='1';r.node('width').value='1281';
 r.apply([r.item(1,false)],{strictPixels:false,fullScreen:false});
 assert.equal(r.context.displayError,'Invalid even size');assert.equal(r.context.displayDraft.width,1281);assert.equal(r.node('width').value,'1281');assert.equal(r.context.displayDraft.strictPixels,false);
});
test('successful save uses backend-normalized precise-mode flags',async()=>{
 const r=fixture();r.apply([r.item(1,false)]);r.context.call=async()=>({ok:true,settings:{strictPixels:false,fullScreen:false}});
 await r.context.saveDisplay({strictPixels:true,width:1920,height:1080});
 assert.equal(r.config.strictPixels,false);assert.equal(r.config.width,1920);assert.equal(r.context.displayDraft,undefined);assert.equal(r.context.displayError,'');
});
test('exact-mode recheck rejection does not create a blocking display error',async()=>{
 const r=fixture();r.apply([r.item()]);r.context.call=async()=>{r.apply([r.item(1,false)],{strictPixels:false,fullScreen:false});return {ok:false,code:'physical-pixels-unavailable',error:'Unavailable'}};
 await r.context.saveDisplay({strictPixels:true});
 assert.equal(r.context.displayError,'');assert.equal(r.node('strictPixels').disabled,true);assert.equal(r.node('strictPixels').checked,false);assert.equal(r.context.displayDraft.strictPixels,undefined);
});
test('an earlier delayed exact-mode save cannot overwrite a later ordinary-mode choice',async()=>{
 const r=fixture(),replies=[];r.apply([r.item()]);r.context.call=()=>new Promise(resolve=>replies.push(resolve));
 const first=r.context.saveDisplay({strictPixels:true}),last=r.context.saveDisplay({strictPixels:false,width:1920,height:1080});
 replies[1]({ok:true,settings:{strictPixels:false,fullScreen:false}});await last;
 replies[0]({ok:true,settings:{strictPixels:true,fullScreen:false}});const old=await first;
 assert.equal(old.code,'display-save-superseded');assert.equal(r.config.strictPixels,false);assert.equal(r.config.width,1920);assert.equal(r.context.displayDraft,undefined);assert.equal(r.context.displayError,'');
});
test('superseded save errors neither replace a newer draft nor prevent starting',async()=>{
 const r=fixture(),replies=[];r.apply([r.item()]);r.context.call=()=>new Promise(resolve=>replies.push(resolve));
 const first=r.context.saveDisplay({fullScreen:true}),last=r.context.saveDisplay({fullScreen:false,width:1920,height:1080});
 let started=0;r.context.running=false;r.context.window={winplayAudio:{prepare:async()=>{}}};r.context.showPage=()=>{};
 vm.runInContext(source.match(/^  \$\('start'\)\.onclick=async\(\)=>\{[^\n]+/m)[0],r.context);
 const start=r.node('start').onclick();replies[0]({ok:false,code:'display-save-superseded'});await first;
 assert.equal(r.context.displayDraft.fullScreen,false);assert.equal(r.context.displayDraft.width,1920);assert.equal(r.context.displayError,'');
 r.context.call=async op=>{if(op==='start')++started;return {ok:true}};replies[1]({ok:true,settings:{strictPixels:false,fullScreen:false}});await last;await start;
 assert.equal(started,1);assert.equal(r.config.fullScreen,false);assert.equal(r.config.width,1920);
});
test('a backend superseded response is silent',async()=>{
 let toasts=0;const context={winplay:{call:async()=>({ok:false,code:'display-save-superseded'})},toast:()=>++toasts};
 vm.runInNewContext(source.match(/^async function call\(op,arg\).*$/m)[0],context);
 assert.equal((await context.call('save',{})).code,'display-save-superseded');assert.equal(toasts,0);
});
