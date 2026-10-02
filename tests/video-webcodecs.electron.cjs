// Standalone offline Electron check. It never opens the WinPlay main window or a receiver connection.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
const output=process.env.WINPLAY_VIDEO_TEST_OUTPUT||path.join(__dirname,'../docs/validation/video-webcodecs');
async function checkWebCodecs(){
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[];
 const check=(name,passed,detail)=>{checks.push({name,passed,detail});if(!passed)throw Error(name+': '+JSON.stringify(detail))};
 function difference(first,second){let sum=0,max=0;for(let i=0;i<first.length;i++){if(i%4===3)continue;const n=Math.abs(first[i]-second[i]);sum+=n;max=Math.max(max,n)}return {mean:sum/(first.length/4*3),max}}
 const makeCanvas=(width,height)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return {canvas,context:canvas.getContext('2d',{alpha:false})}};
 const pixels=plane=>plane.context.getImageData(0,0,plane.canvas.width,plane.canvas.height).data;
 async function encode(width,height,total){
  const plane=makeCanvas(width,height),frames=[];let description,finalPixels;
  const encoder=new VideoEncoder({output(chunk,meta){const data=new Uint8Array(chunk.byteLength);chunk.copyTo(data);frames.push({data,timestamp:chunk.timestamp,type:chunk.type});if(meta.decoderConfig?.description)description=new Uint8Array(meta.decoderConfig.description)},error(error){throw error}});
  const options={codec:'avc1.42001f',width,height,bitrate:160000,framerate:60,latencyMode:'realtime',hardwareAcceleration:'prefer-software',avc:{format:'avc'}};
  const support=await VideoEncoder.isConfigSupported(options);check('offline H264 encoder '+width+'x'+height,support.supported);encoder.configure(options);
  for(let index=0;index<total;index++){
   const c=plane.context,gradient=c.createLinearGradient(0,0,width,height);gradient.addColorStop(0,'#19232a');gradient.addColorStop(1,'#5b586a');c.fillStyle=gradient;c.fillRect(0,0,width,height);
   c.fillStyle='#f5f5f5';c.font='bold 22px sans-serif';c.fillText('WinPlay video fixture',18,35);c.fillStyle=index%2?'#aa592f':'#bd6a35';c.fillRect(20+index*4%Math.max(24,width-110),height/2,80,60);
   if(index===total-1)finalPixels=pixels(plane);const frame=new VideoFrame(plane.canvas,{timestamp:index*16667});encoder.encode(frame,{keyFrame:index%30===0});frame.close();if(encoder.encodeQueueSize>8)await sleep(2);
  }
  await encoder.flush();encoder.close();return {frames,description,finalPixels,width,height};
 }
 async function nativeDecode(fixture){
  const plane=makeCanvas(fixture.width,fixture.height);let count=0,error;
  const decoder=new VideoDecoder({output(frame){try{plane.context.drawImage(frame,0,0);count++}finally{frame.close()}},error:e=>error=e.message});
  const bytes=fixture.description,config={codec:'avc1.'+[bytes[1],bytes[2],bytes[3]].map(n=>n.toString(16).padStart(2,'0')).join(''),description:bytes,optimizeForLatency:true,hardwareAcceleration:'prefer-hardware'};
  decoder.configure(config);for(const frame of fixture.frames)decoder.decode(new EncodedVideoChunk({type:frame.type,data:frame.data,timestamp:frame.timestamp}));await decoder.flush();decoder.close();if(error)throw Error(error);return {pixels:pixels(plane),count};
 }
 function receiver(Decoder=VideoDecoder){
  const plane=makeCanvas(640,360),state={count:0,draws:0,requests:0,recoveries:[],errors:[],acknowledgments:[]};
  const painter=new WinPlayLatestVideoPainter({schedule:callback=>{state.paintCallback=callback;return 1},cancel:()=>state.paintCallback=undefined,fail:reason=>state.errors.push(reason),draw(frame){if(plane.canvas.width!==frame.displayWidth||plane.canvas.height!==frame.displayHeight){plane.canvas.width=frame.displayWidth;plane.canvas.height=frame.displayHeight}plane.context.drawImage(frame,0,0);state.draws++}});
  const stream=new WinPlayVideoReceiver({Decoder,Chunk:EncodedVideoChunk,reset:()=>painter.clear(),ack:(frame,decoderState)=>{state.acknowledgments.push({timestamp:frame.timestamp,...decoderState});state.onAck?.()},requestKey:()=>state.requests++,recover:reason=>state.recoveries.push(reason),fail:reason=>state.errors.push(reason),output(frame){state.count++;painter.submit(frame)}});
  return {stream,painter,plane,state,paintLatest(){const callback=state.paintCallback;state.paintCallback=undefined;callback?.()}};
 }
 async function feed(r,frames){for(const frame of frames){r.stream.decode(frame);while(r.stream.decoder?.decodeQueueSize>4)await sleep(2)}if(r.stream.decoder?.state==='configured')await r.stream.decoder.flush();r.paintLatest();if(r.state.errors.length)throw Error(r.state.errors.join('; '))}
 async function boundedFeed(r,frames){
  let inFlight=0,maxInFlight=0,index=0,pumping=false,pauses=0;
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('decoder dequeue did not release the bounded video queue')),2000);
   const pump=()=>{if(pumping)return;pumping=true;while(index<frames.length&&inFlight<16){inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);const frame=frames[index++];r.stream.decode(frame)}pumping=false;if(index<frames.length&&inFlight===16)pauses++;if(index===frames.length&&inFlight===0){clearTimeout(timer);resolve()}};
   r.state.onAck=()=>{inFlight--;pump()};pump();
  });r.state.onAck=undefined;await r.stream.decoder.flush();r.paintLatest();return {maxInFlight,pauses};
 }
 const fixture=await encode(640,360,60),reference=await nativeDecode(fixture),steady=receiver();
 try{
  await steady.stream.configure({data:fixture.description});const delivery=await boundedFeed(steady,fixture.frames),comparison=difference(reference.pixels,pixels(steady.plane));
  check('continuous long-GOP receiver matches direct WebCodecs pixels with bounded dequeue acknowledgments',steady.state.count===60&&steady.state.draws===2&&steady.state.acknowledgments.length===60&&delivery.maxInFlight<=16&&comparison.max<=1&&steady.state.recoveries.length===0,{frames:steady.state.count,draws:steady.state.draws,acknowledgments:steady.state.acknowledgments.length,delivery,difference:comparison,recoveries:steady.state.recoveries});
  const sourceDifference=difference(fixture.finalPixels,reference.pixels);check('lossy fixture already contains quantization before receiver drawing',sourceDifference.mean>0.05,{difference:sourceDifference,bitrate:160000});
  let release;const wait=new Promise(resolve=>release=resolve);function DelayedDecoder(options){return new VideoDecoder(options)}DelayedDecoder.isConfigSupported=async config=>{await wait;return VideoDecoder.isConfigSupported(config)};
  const delayed=receiver(DelayedDecoder);
  try{
   const ready=delayed.stream.configure({data:fixture.description});for(const frame of fixture.frames.slice(0,20))delayed.stream.decode(frame);release();await ready;
   for(const frame of fixture.frames.slice(20,30))delayed.stream.decode(frame);check('initialization overflow rejects incomplete delta chain',delayed.state.count===0&&delayed.stream.awaitKey&&delayed.stream.pending.length===0,{frames:delayed.state.count,pending:delayed.stream.pending.length,awaitKey:delayed.stream.awaitKey});
   await feed(delayed,fixture.frames.slice(30));const comparison=difference(reference.pixels,pixels(delayed.plane));check('fresh IDR recovers real decoded pixels after initialization overflow',delayed.state.count===30&&comparison.max<=1,{frames:delayed.state.count,difference:comparison});
  }finally{delayed.painter.close();delayed.stream.close()}
  const before=steady.state.count;steady.stream.decode({...fixture.frames[30],reset:true});for(let attempt=0;attempt<100&&!steady.stream.ready;attempt++)await sleep(2);await feed(steady,fixture.frames.slice(31));
  const resetDifference=difference(reference.pixels,pixels(steady.plane));check('transport IDR reset resumes without reference damage or software fallback',steady.state.count-before===30&&resetDifference.max<=1&&!steady.stream.software,{frames:steady.state.count-before,difference:resetDifference});
  const resized=await encode(320,180,15),resizedReference=await nativeDecode(resized),previous=steady.state.count;await steady.stream.configure({data:resized.description});await feed(steady,resized.frames);
  const resizedDifference=difference(resizedReference.pixels,pixels(steady.plane));check('changed AVC configuration resumes at new dimensions',steady.state.count-previous===15&&steady.plane.canvas.width===320&&steady.plane.canvas.height===180&&resizedDifference.max<=1,{frames:steady.state.count-previous,width:steady.plane.canvas.width,height:steady.plane.canvas.height,difference:resizedDifference});
 }finally{steady.painter.close();steady.stream.close()}
 return {kind:'offline actual WebCodecs H264 pixel comparison',checks,completed:true};
}
app.whenReady().then(async()=>{
 let window,exitCode=0;fs.mkdirSync(output,{recursive:true});
 try{window=new BrowserWindow({show:false,width:640,height:360,webPreferences:{sandbox:true,backgroundThrottling:false}});await window.loadFile(path.join(__dirname,'video-webcodecs.html'));const receiver=fs.readFileSync(path.join(__dirname,'../src/ui/video-decoder.js'),'utf8'),painter=fs.readFileSync(path.join(__dirname,'../src/ui/video-painter.js'),'utf8');const result=await window.webContents.executeJavaScript(receiver+'\n'+painter+'\n('+checkWebCodecs.toString()+')()');result.electron=process.versions.electron;fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(result,null,2));const failure=path.join(output,'failure.txt');if(fs.existsSync(failure))fs.unlinkSync(failure);console.log(JSON.stringify({completed:result.completed,passed:result.checks.filter(check=>check.passed).length,total:result.checks.length}))}
 catch(error){exitCode=1;fs.writeFileSync(path.join(output,'failure.txt'),error.stack);console.error(error.message)}finally{window?.destroy();app.exit(exitCode)}
});
