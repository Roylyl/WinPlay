const test=require('node:test'),assert=require('node:assert/strict'),Painter=require('../src/ui/video-painter.js');
function fixture(){
 const draws=[],closed=[],scheduled=new Map();let next=0;
 const painter=new Painter({draw:frame=>draws.push(frame.id),schedule:callback=>{scheduled.set(++next,callback);return next},cancel:id=>scheduled.delete(id),fail:reason=>assert.fail(reason)});
 const frame=id=>({id,clone(){return {id,close(){closed.push(id)}}}});
 const paint=()=>{const callbacks=[...scheduled.values()];scheduled.clear();for(const callback of callbacks)callback()};return {painter,frame,draws,closed,scheduled,paint};
}
test('first decoded frame paints synchronously before the window can be shown',()=>{const f=fixture();f.painter.submit(f.frame(1));assert.deepEqual(f.draws,[1]);assert.equal(f.scheduled.size,0);assert.equal(f.painter.pending,undefined)});
test('decoded bursts keep one owned clone and paint only the newest frame per animation callback',()=>{
 const f=fixture();f.painter.submit(f.frame(1));for(let id=2;id<=12;id++)f.painter.submit(f.frame(id));assert.deepEqual(f.draws,[1]);assert.equal(f.painter.pending.id,12);assert.equal(f.scheduled.size,1);assert.deepEqual(f.closed,[2,3,4,5,6,7,8,9,10,11]);f.paint();assert.deepEqual(f.draws,[1,12]);assert.equal(f.painter.pending,undefined);assert.equal(f.closed.at(-1),12);
});
test('decoder reset and window teardown cancel rendering and close retained decoded frames',()=>{
 const f=fixture();f.painter.submit(f.frame(1));f.painter.submit(f.frame(2));f.painter.clear();assert.deepEqual(f.closed,[2]);assert.equal(f.scheduled.size,0);f.painter.submit(f.frame(3));f.painter.close();assert.deepEqual(f.closed,[2,3]);assert.equal(f.scheduled.size,0);f.paint();assert.deepEqual(f.draws,[1]);
});
test('implementations without VideoFrame.clone retain immediate rendering compatibility',()=>{const f=fixture();f.painter.submit({id:1});f.painter.submit({id:2});assert.deepEqual(f.draws,[1,2]);assert.equal(f.scheduled.size,0)});
