// SPDX-License-Identifier: GPL-3.0-or-later
export type VideoResetReason='decoder-stall'|'transport-overflow'|'ipc-overflow'|'reconnect';
export type ForwardedVideoFrame = {
 data:Buffer;timestamp:number;frameId:number;generation:number;reset?:boolean;resetReason?:VideoResetReason;
};
type Ack = {frameId?:number;generation?:number;decoderQueueSize?:number};
type Options = {
 send:(frame:ForwardedVideoFrame)=>void;
 pause:(paused:boolean)=>void;
 requestKey:()=>void;
 now?:()=>number;limit?:number;maxBytes?:number;stallMs?:number;
};

// Compressed P-frames must reach the decoder in order. Normal pressure pauses
// TCP parsing instead of discarding references; exceptional loss gates to IDR.
export class VideoFrameGate {
 private generation=0;
 private sequence=0;
 private lengthSize=4;
 private waitingKeyframe=true;
 private resetReason:VideoResetReason|undefined;
 private paused=false;
 private pending=new Map<number,{at:number;bytes:number}>();
 private pendingBytes=0;
 private lastRequest=-Infinity;
 private now:()=>number;
 private limit:number;
 private maxBytes:number;
 private stallMs:number;
 private receivedFrames=0;
 private receivedBytes=0;
 private sentFrames=0;
 private droppedFrames=0;
 private backpressurePauses=0;
 private recoveries=0;
 private maxInFlight=0;
 private maxInFlightBytes=0;
 private decoderQueueSize=0;

 constructor(private options:Options){
  this.now=options.now||Date.now;this.limit=options.limit||16;this.maxBytes=options.maxBytes||2*1024*1024;this.stallMs=options.stallMs||2000;
 }
 configure(description:Buffer):number{
  this.generation++;this.pending.clear();this.pendingBytes=0;this.waitingKeyframe=true;this.resetReason=undefined;
  this.lengthSize=description.length>=5?(description[4]&3)+1:4;
  this.setPaused(false);return this.generation;
 }
 private key(data:Buffer):boolean{
  for(let offset=0;offset+this.lengthSize<=data.length;){
   let size=0;for(let i=0;i<this.lengthSize;i++)size=size*256+data[offset+i];
   offset+=this.lengthSize;if(size<1||offset+size>data.length)return false;
   if((data[offset]&31)===5)return true;offset+=size;
  }
  return false;
 }
 private request(){const now=this.now();if(now-this.lastRequest>=900){this.lastRequest=now;this.options.requestKey()}}
 private setPaused(value:boolean){
  if(this.paused===value)return;this.paused=value;if(value)this.backpressurePauses++;
  this.options.pause(value);
 }
 push(data:Buffer,timestamp:number):void{
  this.receivedFrames++;this.receivedBytes+=data.length;
  const key=this.key(data);
  if(this.pending.size>=this.limit||this.pendingBytes>=this.maxBytes)this.recover();
  if(this.waitingKeyframe&&!key){this.droppedFrames++;this.request();return}
  this.waitingKeyframe=false;
  const frameId=++this.sequence,frame={data,timestamp,frameId,generation:this.generation,...(this.resetReason?{reset:true,resetReason:this.resetReason}:{})};
  this.resetReason=undefined;this.pending.set(frameId,{at:this.now(),bytes:data.length});this.pendingBytes+=data.length;this.sentFrames++;
  this.maxInFlight=Math.max(this.maxInFlight,this.pending.size);
  this.maxInFlightBytes=Math.max(this.maxInFlightBytes,this.pendingBytes);
  // Mark pressure before forwarding; any synchronous ACK may safely release it.
  if(this.pending.size>=this.limit||this.pendingBytes>=this.maxBytes)this.setPaused(true);
  this.options.send(frame);
 }
 ack(message:Ack):void{
  if(message.generation!==this.generation||!Number.isInteger(message.frameId)||!this.pending.has(message.frameId!))return;
  const pending=this.pending.get(message.frameId!)!;
  this.pending.delete(message.frameId!);this.pendingBytes-=pending.bytes;
  if(Number.isInteger(message.decoderQueueSize)&&message.decoderQueueSize!>=0)this.decoderQueueSize=message.decoderQueueSize!;
  if(this.paused&&this.pending.size<=Math.floor(this.limit/2)&&this.pendingBytes<=this.maxBytes/2)this.setPaused(false);
 }
 recover(reason:VideoResetReason='transport-overflow'):void{
  this.generation++;this.pending.clear();this.pendingBytes=0;this.waitingKeyframe=true;this.resetReason=reason;this.recoveries++;
  this.request();this.setPaused(false);
 }
 tick():void{
  const oldest=this.pending.values().next().value;
  if(oldest!==undefined&&this.now()-oldest.at>=this.stallMs)this.recover('decoder-stall');
  if(this.waitingKeyframe)this.request();
 }
 close():void{this.pending.clear();this.pendingBytes=0;this.waitingKeyframe=false;this.setPaused(false)}
 diagnostics(){return {receivedFrames:this.receivedFrames,receivedBytes:this.receivedBytes,sentFrames:this.sentFrames,droppedFrames:this.droppedFrames,backpressurePauses:this.backpressurePauses,recoveries:this.recoveries,maxInFlight:this.maxInFlight,maxInFlightBytes:this.maxInFlightBytes,inFlight:this.pending.size,inFlightBytes:this.pendingBytes,decoderQueueSize:this.decoderQueueSize,waitingKeyframe:this.waitingKeyframe,paused:this.paused}}
}
