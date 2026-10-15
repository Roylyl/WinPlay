const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8');
function windowStub(){
 const calls=[],events=[];let bounds={x:80,y:60,width:800,height:630};
 const win={calls,events,resizable:false,destroyed:false,videoAspectRatio:16/9,
  isDestroyed(){return this.destroyed},isMinimized:()=>false,
  getNativeWindowHandle:()=>({readBigUInt64LE:()=>123n}),
  setResizable(value){this.resizable=value;calls.push(['resizable',value])},
  getBounds:()=>({...bounds}),getContentSize:()=>[bounds.width,bounds.height-30],
  setContentSize(width,height){bounds={...bounds,width,height:height+30};calls.push(['content',width,height])},
  setBounds(value){bounds={...value};calls.push(['bounds',{...value}])},
  show(){calls.push(['show'])},focus(){calls.push(['focus'])},
  webContents:{send:(...args)=>events.push(args)}
 };return win;
}
function fixture(strictPixels=false){
 const win=windowStub(),processes=[],logs=[];
 const context={video:win,videoPixelSize:{width:1440,height:900,strictPixels,fullScreen:false},videoSized:true,
  native:'test-platform.exe',selfTest:false,videoDecoded:true,videoHidden:false,stops:0,
  screen:{getDisplayMatching:()=>({scaleFactor:1.5,workArea:{x:0,y:0,width:1600,height:1000}})},
  execFile:(_file,args,_options,callback)=>processes.push({args,callback}),
  log:(...args)=>logs.push(args),stop(){context.stops++}
 };
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function setVideoPixels('),source.indexOf('// Apply one client-area ratio constraint')),context);
 return {context,win,processes,logs,start:()=>context.setVideoPixels()};
}
function failHelper(h,stage){
 if(stage==='window-frame')h.processes[0].callback(null);
 const pending=h.processes.at(-1);assert.equal(pending.args[0],stage);pending.callback(Error('simulated helper failure'));
}
for(const stage of ['window-pixels','window-frame']){
 test(stage+' failure keeps ordinary video usable and fits its client area to the video ratio',()=>{
  const h=fixture();h.start();assert.equal(h.context.videoSized,false);failHelper(h,stage);
  assert.equal(h.context.stops,0);assert.equal(h.context.videoSized,true);assert.equal(h.win.resizable,true);
  assert.deepEqual(h.win.getContentSize(),[960,540]);
  assert.ok(h.win.calls.some(([op,w,h])=>op==='content'&&w===960&&h===600));
  assert.ok(h.win.calls.some(([op])=>op==='show'));assert.ok(h.win.calls.some(([op])=>op==='focus'));
  assert.equal(h.win.events.length,1);assert.equal(h.win.events[0][1].type,'video-viewport');assert.equal(h.win.events[0][1].strictPixels,false);
 });
 test(stage+' failure stops exact sizing instead of silently changing its pixel contract',()=>{
  const h=fixture(true);h.start();failHelper(h,stage);
  assert.equal(h.context.stops,1);assert.equal(h.context.videoSized,false);assert.equal(h.win.events.length,0);
  assert.equal(h.win.calls.some(([op])=>op==='content'||op==='show'),false);
 });
 test('late '+stage+' callback cannot change a replacement video window',()=>{
  const h=fixture();h.start();if(stage==='window-frame')h.processes[0].callback(null);
  const oldCalls=h.win.calls.length,replacement=windowStub(),size={width:800,height:450,strictPixels:false};
  h.context.video=replacement;h.context.videoSized=true;h.context.videoPixelSize=size;
  h.processes.at(-1).callback(Error('late helper failure'));
  assert.equal(h.context.stops,0);assert.equal(h.context.videoSized,true);assert.equal(h.context.videoPixelSize,size);
  assert.equal(h.win.calls.length,oldCalls);assert.equal(h.win.events.length,0);assert.equal(replacement.calls.length,0);assert.equal(replacement.events.length,0);
 });
}
