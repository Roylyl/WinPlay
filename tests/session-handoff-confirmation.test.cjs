const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {CpStack}=require('../build/engine/protocol/cpStack');

function connect(stack){
 const socket=new EventEmitter();Object.assign(socket,{remoteAddress:'127.0.0.1',remotePort:12345,destroyed:false,setKeepAlive(){},destroy(){if(!this.destroyed){this.destroyed=true;this.emit('close')}}});
 stack.attachSocket(socket);return {socket,session:[...stack._sessionSock.keys()].at(-1)};
}
const record={method:'RECORD',path:'/',headers:{},body:Buffer.alloc(0)};
test('TCP arrival, target SETUP and unauthenticated RECORD cannot confirm network handoff',async t=>{
 const stack=new CpStack({mfi:{}});t.after(()=>stack.stop());stack.deviceFilter=()=>true;
 const {session}=connect(stack);assert.equal(stack.hasVerifiedSession,false);
 session.deviceAccepted=true;session.setupComplete=true;assert.equal(stack.hasVerifiedSession,false);
 await stack._handle(record,session);assert.equal(stack.hasVerifiedSession,false);
 session.pairVerify._verified=true;assert.equal(stack.hasVerifiedSession,true);
 for(const flag of ['closed','ended','endRequested']){session[flag]=true;assert.equal(stack.hasVerifiedSession,false);session[flag]=false}
 stack.stop();assert.equal(stack.hasVerifiedSession,false);
});
test('verified handoff state is available to session-active listeners and released before connection-closed',async t=>{
 const stack=new CpStack({mfi:{}});t.after(()=>stack.stop());stack.deviceFilter=()=>true;
 const {socket,session}=connect(stack);Object.assign(session,{deviceAccepted:true,setupComplete:true});session.pairVerify._verified=true;
 let active=false,closed=0,ended=0;
 stack.on('session-active',()=>{active=stack.hasVerifiedSession});stack.on('session-ended',()=>ended++);
 stack.on('connection-closed',()=>{closed++;assert.equal(stack.hasVerifiedSession,false);assert.equal(stack._sessionSock.size,0)});
 await stack._handle(record,session);assert.equal(active,true);socket.destroy();socket.destroy();assert.equal(ended,1);assert.equal(closed,1);
});
test('a rejected or incomplete control connection reports transport closure without ending another session',async t=>{
 const stack=new CpStack({mfi:{}});t.after(()=>stack.stop());stack.deviceFilter=()=>true;
 const old=connect(stack),live=connect(stack);Object.assign(live.session,{deviceAccepted:true,setupComplete:true});live.session.pairVerify._verified=true;
 await stack._handle(record,live.session);let ended=0,closed=0;stack.on('session-ended',()=>ended++);stack.on('connection-closed',()=>closed++);
 old.socket.destroy();assert.equal(closed,1);assert.equal(ended,0);assert.equal(stack.hasVerifiedSession,true);assert.equal(stack._liveSession,live.session);
 live.socket.destroy();assert.equal(closed,2);assert.equal(ended,1);assert.equal(stack.hasVerifiedSession,false);
});
