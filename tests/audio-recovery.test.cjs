const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Timeline=require('../src/ui/audio-timeline');

// Offline output model: evaluate the emitted buffers and gain automation at
// physical 48kHz sample positions. No endpoint or wireless connection is used.
function harness({compactPTS=false,deferOutput=false}={}){
 let now=0,pump,diagnostics;const sources=[],decoders=[],messages=[];
 class Parameter{
  constructor(){this.value=1;this.events=[]}
  setValueAtTime(value,time){this.events.push({kind:'set',value,time});this.sort()}
  linearRampToValueAtTime(value,time){this.events.push({kind:'ramp',value,time});this.sort()}
  sort(){this.events.sort((a,b)=>a.time-b.time)}
  cancelScheduledValues(time){this.events=this.events.filter(e=>e.time<time)}
  cancelAndHoldAtTime(time){const value=this.at(time);this.cancelScheduledValues(time);this.setValueAtTime(value,time)}
  setTargetAtTime(value,time){this.setValueAtTime(value,time)}
  at(time){let value=this.value,previous=0;for(const e of this.events){if(e.time>time)return e.kind==='ramp'?value+(e.value-value)*Math.max(0,(time-previous)/(e.time-previous)):value;value=e.value;previous=e.time}return value}
 }
 class Gain{constructor(){this.gain=new Parameter();this.disconnected=false}connect(node){this.target=node}disconnect(){this.disconnected=true}}
 class Context{
  constructor(){this.state='running';this.sampleRate=48000;this.destination={};this.sinkId=''}
  get currentTime(){return now}
  async setSinkId(id){this.sinkId=id}async resume(){}async suspend(){}
  createGain(){return new Gain()}
  createBuffer(channels,frames,rate){const planes=Array.from({length:channels},()=>new Float32Array(frames));return {duration:frames/rate,sampleRate:rate,numberOfChannels:channels,getChannelData:c=>planes[c]}}
  createBufferSource(){const source={playbackRate:{value:1},connect(node){this.envelope=node},disconnect(){this.disconnected=true},start(when,trim){this.when=when;this.trim=trim;sources.push(this)},stop(when=now){this.stopAt=when}};return source}
 }
 class Decoder{
  static async isConfigSupported(){return {supported:true}}
  constructor(callbacks){this.callbacks=callbacks;this.submitted=[];this.decodeQueueSize=0;this.outputFrames=0;this.origin=null;decoders.push(this)}
  configure(config){this.config=config;this.state='configured'}close(){this.state='closed'}
  decode(chunk){this.submitted.push(chunk);this.origin??=chunk.timestamp;if(!deferOutput)this.output(compactPTS?this.origin+Math.round(this.outputFrames/48000*1000000):chunk.timestamp);this.outputFrames+=1024}
  output(timestamp,value=.75){const data={numberOfChannels:2,numberOfFrames:1024,sampleRate:48000,timestamp,closed:false,copyTo(plane){plane.fill(value)},close(){this.closed=true}};this.callbacks.output(data);return data}
 }
 const scope={AudioContext:Context,AudioDecoder:Decoder,EncodedAudioChunk:class{constructor(v){Object.assign(this,v)}},WinPlayAudioTimeline:Timeline,performance:{now:()=>now*1000},navigator:{mediaDevices:{addEventListener(){}}},winplay:{input:m=>messages.push(m)},setInterval:(fn,ms)=>{if(ms===10)pump=fn;else if(ms===10000)diagnostics=fn},window:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/ui/audio.js'),'utf8'),scope);
 const audio=scope.window.winplayAudio;
 return {audio,sources,decoders,messages,setTime(t){now=t},pump(){pump()},stats(){diagnostics();return messages.filter(m=>m.command==='audio-diagnostic').map(m=>JSON.parse(m.reason)).filter(v=>!v.phase).at(-1)},
  sample(time){let value=0;for(const s of sources){const elapsed=time-s.when;if(elapsed<0||time>=(s.stopAt??Infinity))continue;const offset=elapsed+s.trim,index=Math.floor(offset*s.buffer.sampleRate+1e-7),plane=s.buffer.getChannelData(0);if(index>=plane.length)continue;value+=plane[index]*s.envelope.gain.at(time)}return value},
  async open(codec='pcm',realtime=false){await audio.prepare({});audio.handle({type:'audio-config',id:1,opts:{codec,clockRate:48000,channels:2,latencyMs:250,realtime}});await new Promise(r=>setImmediate(r));audio.handle({type:'audio-active',id:1,active:true})},
  packet(sequence,sample,codec='pcm'){const data=codec==='pcm'?new Uint8Array(4096):new Uint8Array([1]);if(codec==='pcm'){const view=new DataView(data.buffer);for(let i=0;i<2048;i++)view.setInt16(i*2,24576,false)}audio.handle({type:'audio',id:1,sequence,sample,data})}
 }
}

test('late reordered AAC is rejected before decoding, without contaminating subsequent decoder history',async()=>{
 const h=harness();await h.open('aac-lc');h.packet(1,0,'aac-lc');h.packet(3,2048,'aac-lc');h.setTime(.21);h.pump();h.packet(2,1024,'aac-lc');h.packet(4,3072,'aac-lc');h.setTime(.24);h.pump();
 assert.deepEqual(h.decoders.at(-1).submitted.map(c=>c.timestamp),[0,42667,64000]);const stats=h.stats();assert.equal(stats.late,1);assert.equal(stats.missing,1);assert(h.sources.every(s=>s.playbackRate.value===1));
});

test('timely continuous output has no periodic fades, clipping, or cumulative frame gaps',async()=>{
 const h=harness();await h.open();for(let i=0;i<20;i++)h.packet(i,i*1024);for(let t=.151;t<.67;t+=.01){h.setTime(t);h.pump()}
 assert.equal(h.sources.length,20);for(let i=0;i<20;i++){const s=h.sources[i];assert.equal(s.trim,0);assert.equal(s.playbackRate.value,1);if(i)assert(Math.abs(s.when-h.sources[i-1].when-1024/48000)<1e-10)}
 const begin=.25+.004,end=.25+20*1024/48000-.004;for(let t=begin;t<end;t+=1/48000)assert(Math.abs(h.sample(t)-.75)<1e-7,`unexpected modulation at ${t}`);
});

test('a missing packet leaves silence with bounded waveform edges instead of hard DC steps',async()=>{
 const h=harness();await h.open();for(let i=0;i<12;i++)if(i!==5)h.packet(i,i*1024);for(let t=.151;t<.55;t+=.01){h.setTime(t);h.pump()}
 const gapBegin=.25+5*1024/48000,gapEnd=.25+6*1024/48000;for(let t=gapBegin;t<gapEnd;t+=1/48000)assert(Math.abs(h.sample(t))<1e-7);
 let jump=0;for(let t=gapBegin-.004;t<gapEnd+.004;t+=1/48000)jump=Math.max(jump,Math.abs(h.sample(t+1/48000)-h.sample(t)));
 assert(jump<.006,`gap introduced a ${jump} sample step`);assert.equal(h.stats().discontinuity,1);
});

test('partial late output and starvation recovery fade their actual audible boundaries at fixed rate',async()=>{
 const h=harness();await h.open('pcm',true);h.packet(1,0);h.setTime(.11);h.pump();assert(h.sources[0].trim>0);
 h.packet(2,1024);h.setTime(1);h.pump();assert.equal(h.sources.length,2);assert(h.sources.every(s=>s.playbackRate.value===1));
 for(const s of h.sources){assert(Math.abs(h.sample(s.when))<1e-7);const end=s.when+s.buffer.duration-s.trim;assert(Math.abs(h.sample(end))<1e-7);let jump=0;for(let t=s.when;t<end;t+=1/48000)jump=Math.max(jump,Math.abs(h.sample(t+1/48000)-h.sample(t)));assert(jump<.01)}
});

test('reset fades a playing source and retired decoder output/errors cannot affect the new epoch',async()=>{
 const h=harness();await h.open('aac-lc',true);h.packet(1,48000,'aac-lc');h.setTime(.061);h.pump();const oldDecoder=h.decoders.at(-1),oldSource=h.sources[0];h.setTime(.11);h.packet(2,0,'aac-lc');
 assert(oldSource.stopAt>.11&&oldSource.stopAt<=.1130000001);assert.equal(oldDecoder.state,'closed');const count=h.sources.length,stale=oldDecoder.output(0);assert(stale.closed);assert.equal(h.sources.length,count);oldDecoder.callbacks.error(new Error('retired'));assert(!h.messages.some(m=>m.command==='audio-error'));
 h.setTime(.171);h.pump();assert.equal(h.sources.length,2);const replacement=h.sources[1];oldSource.onended();h.packet(3,1024,'aac-lc');h.setTime(.2);h.pump();assert.equal(h.sources.length,3);assert(!replacement.disconnected);assert.equal(h.sources[2].envelope.gain.at(h.sources[2].when),1);
});

test('RTP timestamp and sequence rollover preserve real sample spacing',async()=>{
 const h=harness();await h.open('aac-lc');h.packet(65535,0xfffffc00,'aac-lc');h.packet(0,0,'aac-lc');h.setTime(.19);h.pump();assert.deepEqual(h.decoders.at(-1).submitted.map(c=>c.timestamp),[0,21333]);assert.equal(h.sources[1].trim,0);assert(Math.abs(h.sources[1].when-h.sources[0].when-1024/48000)<1e-10);
});

for(const missing of [5,7])test(`${missing} missing AAC access units do not permanently discard later compacted decoder output`,async()=>{
 const h=harness({compactPTS:true});await h.open('aac-lc');h.packet(0,0,'aac-lc');const duration=1024/48000,total=250;
 for(let i=0;i<total;i++){h.setTime(.151+i*duration);if(i>0&&(i<60||i>=60+missing))h.packet(i,i*1024,'aac-lc');h.pump()}
 assert.equal(h.sources.length,total-missing);const stats=h.stats();assert.equal(stats.missing,missing);assert.equal(stats.late,0);assert.equal(stats.discontinuity,1);assert.equal(stats.mappingReset,0);
 for(let i=0;i<h.sources.length;i++){const source=h.sources[i],packet=i<60?i:i+missing;assert.equal(source.trim,0);assert.equal(source.playbackRate.value,1);assert(Math.abs(source.when-(.25+packet*duration))<1e-9)}
 // Undamaged samples remain full-amplitude after the real loss interval.
 for(let i=65+missing;i<total-2;i++){const time=.25+i*duration+.01;assert(Math.abs(h.sample(time)-.75)<1e-7)}
 const timing=h.messages.filter(m=>m.command==='audio-diagnostic').map(m=>JSON.parse(m.reason)).find(v=>v.phase==='timing');assert.deepEqual(timing.frames,[1024,1024]);assert.deepEqual(timing.rate,[48000,48000]);assert.equal(timing.pending,0);assert.equal(timing.ptsGapMs[1],Math.round(missing*duration*10000)/10);assert.deepEqual(timing.waitMs,[0,151]);
});

test('AAC decoder failures restart only three times and stale callbacks cannot alter a recovered decoder',async()=>{
 const h=harness();await h.open('aac-lc');const retired=h.decoders.at(-1);retired.state='closed';retired.callbacks.error(new Error('synthetic malformed AAC'));
 assert.notEqual(h.decoders.at(-1),retired);const active=h.decoders.at(-1);retired.output(0);retired.callbacks.error(new Error('retired error'));assert.equal(h.decoders.at(-1),active);assert.equal(h.sources.length,0);
 h.packet(0,0,'aac-lc');h.setTime(.151);h.pump();assert.equal(h.sources.length,1);
 for(let i=0;i<3;i++){const decoder=h.decoders.at(-1);decoder.state='closed';decoder.callbacks.error(new Error('synthetic malformed AAC'))}
 assert.equal(h.decoders.length,5);assert.equal(h.messages.filter(m=>m.command==='audio-error').length,1);const count=h.decoders.length;h.packet(1,1024,'aac-lc');h.setTime(.2);h.pump();assert.equal(h.decoders.length,count);assert.equal(h.stats().mappingReset,4);
});

test('AAC metadata is bounded and output spans preserve gaps across split and merged AudioData',()=>{
 const Clock=Timeline.PacketClock,clock=new Clock(48000,2);clock.submit(0,1);clock.submit(3072,4);
 assert.throws(()=>clock.submit(4096,5),/积压/);assert.throws(()=>clock.take(2049,48000),/不一致/);assert.throws(()=>clock.take(1024,44100),/不一致/);assert.equal(clock.frames,2048);
 assert.deepEqual(clock.take(512,48000),[{offset:0,frameOffset:0,frames:512}]);assert.deepEqual(clock.take(1536,48000),[{offset:512,frameOffset:0,frames:512},{offset:3072,frameOffset:512,frames:1024}]);assert.equal(clock.frames,0);assert.equal(clock.packets.length,0);
 clock.submit(8192,9);clock.reset();assert.throws(()=>clock.take(1024,48000),/不一致/);clock.submit(0,0);assert.deepEqual(clock.take(1024,48000),[{offset:0,frameOffset:0,frames:1024}]);
});

test('an earlier first RTP packet cannot reanchor an already submitted AAC unit while decoder output is pending',async()=>{
 const h=harness({deferOutput:true});await h.open('aac-lc');h.packet(2,1024,'aac-lc');h.setTime(.151);h.pump();const decoder=h.decoders.at(-1);assert.equal(h.sources.length,0);assert.equal(decoder.submitted.length,1);
 h.packet(1,0,'aac-lc');decoder.output(0);assert.equal(h.sources[0].when,.25);h.packet(3,2048,'aac-lc');h.setTime(.19);h.pump();decoder.output(21333);
 assert.deepEqual(decoder.submitted.map(c=>c.timestamp),[0,21333]);assert(Math.abs(h.sources[1].when-(.25+1024/48000))<1e-9);assert.equal(h.sources[1].trim,0);assert.equal(h.stats().late,1);
});
