(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WinPlayAudioTimeline=factory()})(globalThis,function(){
 // Preserve RTP spacing and decoded duration without accelerating late audio.
 class Timeline {
  constructor(rate,delay){this.rate=rate;this.delay=delay;this.reset()}
  reset(){this.origin=null;this.end=0;this.offset=-1}
  anchor(now){this.origin=now+this.delay}
  ready(offset,now,lead){return this.origin!==null&&this.origin+offset/this.rate-now<=lead}
  plan(offset,duration,now){if(!Number.isFinite(offset)||!Number.isFinite(duration)||duration<=0||offset<=this.offset)return null;
   let reset=false;if(this.origin===null){this.origin=now+this.delay-offset/this.rate;reset=true}
   let expected=this.origin+offset/this.rate;
   if(expected+duration<now-.25||expected>now+2){this.origin=now+this.delay-offset/this.rate;this.end=0;expected=now+this.delay;reset=true}
   this.offset=offset;
   const when=Math.max(expected,now+.005,this.end),trim=Math.max(0,when-expected);
   if(trim>=duration)return null;
   this.end=when+duration-trim;return {when,trim,reset};
  }
 }
 return Timeline;
});
