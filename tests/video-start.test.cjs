const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function receiver(createError){
 const source=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8'),events=[],commands=[];
 const context={running:true,videoReady:false,pendingFrames:[],lastConfig:undefined,createVideo:()=>{events.push('create');if(createError)throw createError},command:message=>{events.push(message.command);commands.push(message)},log:status=>events.push(status),stop:()=>{context.running=false;events.push('stop')}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function handleEngineMessage('),source.indexOf('\nasync function start(')),context);
 return {context,events,commands};
}
test('video configuration alone does not create a window; first video frame creates a hidden decoder window',()=>{
 const r=receiver(),config={type:'video-config',data:Buffer.from([1])},frame={type:'video-frame',data:Buffer.from([2])};
 r.context.handleEngineMessage(config);assert.equal(r.context.lastConfig,config);assert.deepEqual(r.events,[]);
 r.context.handleEngineMessage(frame);assert.deepEqual(r.events,['create']);assert.equal(r.context.pendingFrames[0],frame);
});
test('late video frames after a stop cannot reopen the CarPlay window',()=>{
 const r=receiver();r.context.running=false;r.context.handleEngineMessage({type:'video-frame',frameId:27,generation:3});
 assert.deepEqual(r.events,['video-ack']);assert.equal(r.context.pendingFrames.length,0);
 assert.equal(r.commands[0].frameId,27);assert.equal(r.commands[0].generation,3);
});

test('an overflowing hidden-window queue requests a new reference chain instead of acknowledging a discarded delta',()=>{
 const r=receiver();for(let frameId=1;frameId<=17;frameId++)r.context.handleEngineMessage({type:'video-frame',frameId,generation:1});
 assert.equal(r.context.pendingFrames.length,0);assert.equal(r.commands.length,1);assert.equal(r.commands[0].command,'video-recover');assert.equal(r.commands[0].reason,'ipc-overflow');
});

test('configuration generations and recovery IDRs clear old queued video',()=>{
 const r=receiver();r.context.handleEngineMessage({type:'video-config',generation:1});r.context.handleEngineMessage({type:'video-frame',generation:1,frameId:1});
 r.context.handleEngineMessage({type:'video-config',generation:2});assert.equal(r.context.pendingFrames.length,0);
 r.context.handleEngineMessage({type:'video-frame',generation:2,frameId:2});const idr={type:'video-frame',generation:3,frameId:3,reset:true};r.context.handleEngineMessage(idr);
 assert.equal(r.context.pendingFrames.length,1);assert.equal(r.context.pendingFrames[0],idr);
});
test('display changes while waiting for video report an error and stop cleanly',()=>{
 const r=receiver(Error('monitor unavailable'));r.context.handleEngineMessage({type:'video-frame'});
 assert.deepEqual(r.events,['create','画面窗口尺寸设置失败','stop']);assert.equal(r.context.running,false);
});
