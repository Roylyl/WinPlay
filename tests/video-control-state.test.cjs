const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/ui/app.js'),'utf8');
function fixture(){
 const nodes=new Map();let receive;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,hidden:false,textContent:'',classList:{toggle(){}}});return nodes.get(id)};
 const context={$:node,running:false,config:undefined,lastReceiverStatus:'',text:(id,value)=>node(id).textContent=value,window:{},navigator:{},metadata(){},winplay:{on:handler=>receive=handler}};
 const state=source.match(/^function state\(active\)\{[^\n]+\}/m);assert.ok(state);vm.runInNewContext(state[0],context);
 const start=source.indexOf('winplay.on(message=>{'),end=source.indexOf('\n});',start);assert.ok(start>=0&&end>start);vm.runInNewContext(source.slice(start,end+4),context);
 return {node,context,receive,metrics:width=>receive({type:'metrics',requested:60,attempt:60,receivedFps:60,decodedFps:0,decodedWidth:width,decodedHeight:width?720:0})};
}
test('starting reception shows receiver actions but keeps show-video disabled',()=>{
 const r=fixture();r.receive({type:'starting'});assert.equal(r.context.running,true);assert.equal(r.node('running-actions').hidden,false);assert.equal(r.node('show-video').disabled,true);
});
test('the first encoded-video connection event does not unlock show-video',()=>{
 const r=fixture();r.receive({type:'started'});r.receive({type:'connected'});assert.equal(r.node('side-status').textContent,'已收到视频');assert.equal(r.node('show-video').disabled,true);
});
test('decoded dimensions unlock show-video even when a static image reports zero decoded fps',()=>{
 const r=fixture();r.receive({type:'starting'});r.metrics(0);assert.equal(r.node('show-video').disabled,true);r.metrics(1280);assert.equal(r.node('show-video').disabled,false);
});
test('restart disables show-video and late metrics cannot unlock it after disconnection',()=>{
 const r=fixture();r.receive({type:'started'});r.metrics(1280);assert.equal(r.node('show-video').disabled,false);r.receive({type:'starting'});assert.equal(r.node('show-video').disabled,true);
 r.metrics(1280);r.receive({type:'stopped'});assert.equal(r.context.running,false);assert.equal(r.node('show-video').disabled,true);r.metrics(1280);r.receive({type:'connected'});assert.equal(r.node('show-video').disabled,true);
});
