(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WinPlayAudioTimeline=factory()})(globalThis,function(){
 // Preserve RTP spacing and decoded duration without accelerating late audio.
 class Timeline {
  constructor(rate,delay){this.rate=rate;this.delay=delay;this.reset()}
  reset(){this.origin=null;this.end=0;this.offset=-1}
  anchor(now){this.origin=now+this.delay}
  ready(offset,now,lead){return this.origin!==null&&this.origin+offset/this.rate-now<=lead}
  plan(offset,duration,now){if(!Number.isFinite(offset)||!Number.isFinite(duration)||!Number.isFinite(now)||duration<=0||offset<=this.offset)return null;
   let reset=false;if(this.origin===null){this.origin=now+this.delay-offset/this.rate;reset=true}
   let expected=this.origin+offset/this.rate;
   if(expected+duration<now-.25||expected>now+2){this.origin=now+this.delay-offset/this.rate;this.end=0;expected=now+this.delay;reset=true}
   this.offset=offset;
   let when=Math.max(expected,now+.005,this.end),trim=Math.max(0,when-expected);
   // Floating-point duration sums must not shave samples off contiguous frames.
   if(this.end>0&&Math.abs(expected-this.end)<.5/this.rate&&now+.005<=this.end){when=this.end;trim=0}
   if(trim>=duration)return null;
   this.end=when+duration-trim;return {when,trim,reset};
  }
 }
 // AAC-LC raw access units use the 1024-frame GASpecificConfig advertised by
 // this receiver. Decoder timestamps may compact losses; preserve RTP spans.
 class PacketClock {
  constructor(rate,maxPending=32){this.rate=rate;this.maxPending=maxPending;this.reset()}
  reset(){this.packets=[];this.frames=0}
  submit(offset,sequence){if(!Number.isFinite(offset)||offset<0||this.packets.length>=this.maxPending)throw new Error('AAC时间映射积压超限');this.packets.push({offset,sequence,used:0});this.frames+=1024}
  take(frames,rate){if(rate!==this.rate||!Number.isInteger(frames)||frames<=0||frames>this.frames)throw new Error('AAC解码帧与协商访问单元不一致');const spans=[];let consumed=0;while(consumed<frames){const packet=this.packets[0],count=Math.min(frames-consumed,1024-packet.used);spans.push({offset:packet.offset+packet.used,frameOffset:consumed,frames:count});packet.used+=count;consumed+=count;this.frames-=count;if(packet.used===1024)this.packets.shift()}return spans}
 }
 Timeline.PacketClock=PacketClock;
 return Timeline;
});
