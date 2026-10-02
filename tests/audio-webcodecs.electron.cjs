// Offline synthetic AAC only. No AudioContext, endpoint, microphone or receiver.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
const output=process.env.WINPLAY_AUDIO_TEST_OUTPUT||path.join(__dirname,'../docs/validation/audio-webcodecs');
async function checkAAC(){
 const check=(name,ok,detail)=>{if(!ok)throw Error(name+': '+JSON.stringify(detail))};
 const config={codec:'mp4a.40.2',sampleRate:48000,numberOfChannels:2,bitrate:128000};
 const support=await AudioEncoder.isConfigSupported(config);if(!support.supported)return {available:false,reason:'This Electron AAC encoder is unavailable'};
 const encoded=[];let encodeError;
 const encoder=new AudioEncoder({output(chunk){const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);encoded.push(bytes)},error:error=>encodeError=error.message});encoder.configure(config);
 for(let i=0;i<200;i++){const samples=new Float32Array(2048);for(let n=0;n<1024;n++)samples[n]=samples[n+1024]=.3*Math.sin(2*Math.PI*440*(i*1024+n)/48000);const data=new AudioData({format:'f32-planar',sampleRate:48000,numberOfChannels:2,numberOfFrames:1024,timestamp:Math.round(i*1024/48000*1000000),data:samples});encoder.encode(data);data.close()}
 await encoder.flush();encoder.close();if(encodeError)throw Error(encodeError);check('sufficient synthetic AAC access units',encoded.length>=190,{units:encoded.length});
 async function decode(missing){
  const clock=new WinPlayAudioTimeline.PacketClock(48000),timeline=new WinPlayAudioTimeline(48000,.25),legacy=new WinPlayAudioTimeline(48000,.25),offsets=[],decoded=[],timing={frames:[],gaps:[],late:0,legacyLate:0,legacyTrim:0,trim:0,peak:0};timeline.anchor(0);legacy.anchor(0);let decodeError;
  const decoder=new AudioDecoder({output(data){try{const spans=clock.take(data.numberOfFrames,data.sampleRate);timing.frames.push(data.numberOfFrames);for(const span of spans){const expected=offsets[decoded.length];check('AAC output mapped to its RTP span',span.offset===expected,{actual:span.offset,expected});decoded.push(span.offset);const now=.151+span.offset/48000,plan=timeline.plan(span.offset,span.frames/48000,now);if(!plan)timing.late++;else timing.trim=Math.max(timing.trim,plan.trim);const legacyPlan=legacy.plan(Math.round(data.timestamp*48000/1000000),data.numberOfFrames/data.sampleRate,now);if(!legacyPlan)timing.legacyLate++;else if(legacyPlan.trim>1/48000)timing.legacyTrim++;timing.gaps.push(span.offset/48000-data.timestamp/1000000);const pcm=new Float32Array(span.frames);data.copyTo(pcm,{planeIndex:0,frameOffset:span.frameOffset,frameCount:span.frames,format:'f32-planar'});for(const value of pcm){check('finite AAC output',Number.isFinite(value),{});timing.peak=Math.max(timing.peak,Math.abs(value))}}}finally{data.close()}},error:error=>decodeError=error.message});
  // Exactly the receiver's AAC-LC 48kHz/stereo ASC, with no encoder-delay metadata.
  decoder.configure({codec:'mp4a.40.2',sampleRate:48000,numberOfChannels:2,description:new Uint8Array([0x11,0x90])});
  for(let i=0;i<encoded.length;i++){if(i>=40&&i<40+missing)continue;const offset=i*1024;offsets.push(offset);clock.submit(offset,i);decoder.decode(new EncodedAudioChunk({type:'key',timestamp:Math.round(offset/48000*1000000),data:encoded[i]}));if(decoder.decodeQueueSize>12)await new Promise(resolve=>setTimeout(resolve,1))}
  await decoder.flush();decoder.close();if(decodeError)throw Error(decodeError);
  check('every valid raw AAC AU emitted 1024 samples',decoded.length===offsets.length&&timing.frames.every(n=>n===1024)&&clock.frames===0,{decoded:decoded.length,submitted:offsets.length,frames:[Math.min(...timing.frames),Math.max(...timing.frames)],pending:clock.frames});
  check('RTP scheduling survives packet loss without speed/trim drift',timing.late===0&&timing.trim===0,{late:timing.late,trim:timing.trim});
  if(missing)check('actual AAC decoder compacts losses and exposes the legacy failure',timing.legacyLate+timing.legacyTrim>100&&Math.abs(timing.gaps.at(-1)-missing*1024/48000)<.00001,{legacyLate:timing.legacyLate,legacyTrim:timing.legacyTrim,gap:timing.gaps.at(-1)});
  return {missing,submitted:offsets.length,outputs:decoded.length,frames:[Math.min(...timing.frames),Math.max(...timing.frames)],mappedLate:timing.late,legacyLate:timing.legacyLate,legacyTrim:timing.legacyTrim,finalPtsGapMs:Math.round(timing.gaps.at(-1)*10000)/10,peak:Math.round(timing.peak*1000)/1000};
 }
 return {available:true,checks:[await decode(0),await decode(5),await decode(7)]};
}
app.whenReady().then(async()=>{let window,exit=0;try{window=new BrowserWindow({show:false,webPreferences:{sandbox:true,backgroundThrottling:false}});await window.loadFile(path.join(__dirname,'video-webcodecs.html'));const source=fs.readFileSync(path.join(__dirname,'../src/ui/audio-timeline.js'),'utf8'),result={electron:process.versions.electron,...await window.webContents.executeJavaScript(source+'\n('+checkAAC.toString()+')()')};fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))}catch(error){exit=1;console.error(error.stack)}finally{window?.destroy();app.exit(exit)}});
