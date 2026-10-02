import { fields, iapText } from './iap'
export type Playing={title:string;artist:string;album:string;trackId:string;appId:string;durationMs:number;positionMs:number;playing:boolean;canSeek:boolean;artwork?:Buffer;generation:number}
export class NowPlaying {
 state:Playing={title:'',artist:'',album:'',trackId:'',appId:'',durationMs:0,positionMs:0,playing:false,canSeek:false,generation:0}
 private stamp=performance.now();private tags=new Map<number,number>();private transfers=new Map<number,{parts:Buffer[];bytes:number;generation:number}>();private cached=new Map<number,{data:Buffer;generation:number}>();private artworkId:number|undefined;private seekUntil=0;private timer:NodeJS.Timeout|undefined;private lastArtworkPublish=-Infinity;private pendingArt=false;private published="";private closed=false
 constructor(private update:(s:Playing,artChanged:boolean)=>void,private reply:(b:Buffer)=>void){}
 apply(p:Map<number,Buffer>){if(this.closed)return;const media=p.has(0)?fields(p.get(0)!):new Map<number,Buffer>(),play=p.has(1)?fields(p.get(1)!):new Map<number,Buffer>();let changed=false
  const id=media.get(0),app=play.get(16);const nextId=id&&id.length===8?id.readBigUInt64BE().toString():this.state.trackId;const nextApp=app?iapText(app):this.state.appId
  const trackChanged=!!this.state.trackId&&nextId!==this.state.trackId||!!this.state.appId&&nextApp!==this.state.appId
  if(trackChanged){this.state={...this.state,title:'',artist:'',album:'',durationMs:0,positionMs:0,canSeek:false,artwork:undefined,generation:this.state.generation+1};this.artworkId=undefined;this.seekUntil=0;this.lastArtworkPublish=-Infinity;if(this.timer){clearTimeout(this.timer);this.timer=undefined}changed=true}
  this.state.positionMs=this.position();this.stamp=performance.now();this.state.trackId=nextId;this.state.appId=nextApp
  if(media.has(1))this.state.title=iapText(media.get(1));if(media.has(6))this.state.album=iapText(media.get(6));if(media.has(12))this.state.artist=iapText(media.get(12))
  const duration=media.get(4);if(duration?.length===4)this.state.durationMs=duration.readUInt32BE()
  const position=play.get(1);if(position?.length===4){const value=position.readUInt32BE();if(performance.now()>this.seekUntil||Math.abs(value-this.state.positionMs)<2000){this.state.positionMs=value;this.seekUntil=0}}
  const status=play.get(0);if(status?.length)this.state.playing=status[0]===1
  if(play.has(13)){const b=play.get(13)!;this.state.canSeek=b.length===0||b.length===1&&b[0]===1}
  const ftid=media.get(26);if(ftid?.length===1){const n=ftid[0];this.artworkId=n;this.tags.set(n,this.state.generation);const art=this.cached.get(n);if(art?.generation===this.state.generation){if(!this.state.artwork?.equals(art.data)){this.state.artwork=art.data;changed=true}this.cached.delete(n)}}
  this.publish(changed)
 }
 file(b:Buffer){if(this.closed||b.length<2)return;const id=b[0],ctrl=b[1],data=b.subarray(2);if(ctrl===2){this.transfers.delete(id);return}
  if(ctrl===4){this.transfers.set(id,{parts:[],bytes:0,generation:this.tags.get(id)??this.state.generation});this.reply(Buffer.from([id,1]));return}
  if(ctrl===128||ctrl===192)this.transfers.set(id,{parts:[],bytes:0,generation:this.tags.get(id)??this.state.generation})
  if(![0,64,128,192].includes(ctrl))return;const t=this.transfers.get(id);if(!t)return;t.parts.push(data);t.bytes+=data.length;if(t.bytes>8*1024*1024){this.transfers.delete(id);this.reply(Buffer.from([id,2]));return}
  if(ctrl===64||ctrl===192){this.transfers.delete(id);this.reply(Buffer.from([id,5]));const art=Buffer.concat(t.parts);if(!isArtwork(art)||t.generation!==this.state.generation)return;if(this.artworkId===id&&this.tags.get(id)===t.generation){if(!this.state.artwork?.equals(art)){this.state.artwork=art;this.publish(true)}}else{if(this.cached.size>=8)this.cached.delete(this.cached.keys().next().value!);this.cached.set(id,{data:art,generation:t.generation})}}
 }
 // Keep lyrics live. Only changed artwork is throttled, independently of text.
 private publish(artChanged:boolean){this.pendingArt ||= artChanged;const wait=5000-(performance.now()-this.lastArtworkPublish);this.flush(this.pendingArt&&wait<=0);if(this.pendingArt&&!this.timer){this.timer=setTimeout(()=>{this.timer=undefined;this.flush(true)},Math.max(0,wait));this.timer.unref()}}
 private flush(includeArt:boolean){if(this.closed)return;const {artwork,...text}=this.state;const signature=JSON.stringify([text.title,text.artist,text.album,text.trackId,text.appId,text.durationMs,text.playing,text.canSeek,text.generation]);const changed=includeArt&&this.pendingArt;if(signature===this.published&&!changed)return;if(changed){this.pendingArt=false;this.lastArtworkPublish=artwork?performance.now():-Infinity;if(this.timer){clearTimeout(this.timer);this.timer=undefined}}this.published=signature;this.update({...text,positionMs:this.position(),...(changed&&artwork?{artwork}:{})},changed)}
 close(){this.closed=true;if(this.timer)clearTimeout(this.timer);this.transfers.clear();this.cached.clear();this.tags.clear()}
 position(){const elapsed=this.state.playing?performance.now()-this.stamp:0;return Math.min(this.state.durationMs||Infinity,Math.max(0,this.state.positionMs+elapsed))}
 seek(ms:number){if(!this.state.canSeek||this.state.durationMs<=0)return false;this.state.positionMs=Math.max(0,Math.min(this.state.durationMs,ms));this.stamp=performance.now();this.seekUntil=this.stamp+1500;return true}
}
export function isArtwork(b:Buffer){return b.length>8&&(b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||b[0]===255&&b[1]===216&&b[2]===255)}
