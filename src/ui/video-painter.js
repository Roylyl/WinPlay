(function(root){
 class LatestVideoPainter{
  constructor(api){this.api=api;this.painted=false;this.pending=undefined;this.request=0}
  submit(frame){
   if(!this.painted||typeof frame.clone!=='function'){this.api.draw(frame);this.painted=true;return}
   const latest=frame.clone();this.pending?.close();this.pending=latest;
   if(!this.request)this.request=this.api.schedule(()=>this.paint());
  }
  paint(){
   this.request=0;const frame=this.pending;this.pending=undefined;if(!frame)return;
   try{this.api.draw(frame)}catch(error){this.api.fail?.(error.message)}finally{frame.close()}
  }
  clear(){if(this.request)this.api.cancel(this.request);this.request=0;this.pending?.close();this.pending=undefined}
  close(){this.clear()}
 }
 if(typeof module==='object')module.exports=LatestVideoPainter;else root.WinPlayLatestVideoPainter=LatestVideoPainter;
})(globalThis);
