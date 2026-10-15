// Windows audio transport; decoding/capture runs in the Chromium WebCodecs
// renderer and uses Windows' default or selected endpoint. Wire format follows
// MacPlay's livi-gst-video/rust/audio and rust/mic implementations.
import dgram from 'node:dgram'
import { chachaOpen, chachaSeal, nonce64 } from './protocol/crypto'
export type CpAudioCodec='aac-lc'|'opus'|'pcm'
const send=(data:any)=>{if(process.connected)process.send?.(data)}
let nextId=1
const receivers=new Map<number,{data:dgram.Socket;control:dgram.Socket;active:boolean;started:boolean;volume:number;lastAuthenticatedNs:bigint}>()
export function audioReceiverLastActivityNs(id:number):bigint{return receivers.get(id)?.lastAuthenticatedNs||0n}
const transportStats=new Map<number,{packets:number;bytes:number;decryptErrors:number;forwarded:number;lastPacketAt:number}>()
export function reportAudioTransport(){for(const [id,stats] of transportStats)send({type:'diagnostic',status:'音频网络接收统计',detail:JSON.stringify({stream:id,...stats,lastPacketAt:undefined,silenceMs:stats.lastPacketAt?Date.now()-stats.lastPacketAt:undefined,active:receivers.get(id)?.active})})}
const microphones=new Map<number,{socket:dgram.Socket;key:Buffer;opts:any;seq:number;timestamp:number;nonce:bigint}>()
async function bind(s:dgram.Socket):Promise<number>{return new Promise((resolve,reject)=>{s.once('error',reject);s.bind({port:0,address:'::'},()=>{s.off('error',reject);s.on('error',()=>send({type:'status',status:'音频网络端口错误'}));resolve(s.address().port)})})}
export function decryptAudio(key:Buffer,b:Buffer){if(b.length<36)throw new Error('音频包太短');const nonce=Buffer.alloc(12);b.subarray(-8).copy(nonce,4);return chachaOpen(key,nonce,b.subarray(12,-8),b.subarray(4,12))}
export async function openAudioReceiver(key:Buffer,o:any,started?:(id:number,sample:number)=>void){const id=nextId++,data=dgram.createSocket('udp6'),control=dgram.createSocket('udp6');let dataPort:number,controlPort:number;try{[dataPort,controlPort]=await Promise.all([bind(data),bind(control)])}catch(e){try{data.close()}catch{}try{control.close()}catch{}throw e}
 const r={data,control,active:false,started:false,volume:1,lastAuthenticatedNs:0n};receivers.set(id,r);const stats={packets:0,bytes:0,decryptErrors:0,forwarded:0,lastPacketAt:0};transportStats.set(id,stats);send({type:'audio-config',id,opts:o});send({type:'diagnostic',status:'连接诊断：音频UDP端口就绪',detail:JSON.stringify({stream:id,dataPort,controlPort})});
 // Keep the callback with its receiver. An unrelated TCP connection must not
 // replace the established session's media-clock and microphone owner.
 data.on('message',b=>{if(receivers.get(id)!==r)return;stats.packets++;stats.bytes+=b.length;stats.lastPacketAt=Date.now();let raw:Buffer;try{raw=decryptAudio(key,b)}catch{stats.decryptErrors++;return}r.lastAuthenticatedNs=process.hrtime.bigint();if(!r.started){r.started=true;send({type:'diagnostic',status:'连接诊断：音频首包解密成功',detail:JSON.stringify({stream:id,packetBytes:b.length})});started?.(id,b.readUInt32BE(4))}if(r.active){stats.forwarded++;send({type:'audio',id,sample:b.readUInt32BE(4),sequence:b.readUInt16BE(2),data:raw})}})
 return {streamId:id,dataPort,controlPort}
}
export function setAudioReceiverActive(id:number,active:boolean){const r=receivers.get(id);if(r)r.active=active;send({type:'audio-active',id,active})}
export function setAudioReceiverVolume(id:number,level:number,_ms:number){const r=receivers.get(id);if(r)r.volume=level;send({type:'audio-volume',id,level})}
export function closeAudioReceiver(id:number){const r=receivers.get(id);if(r){const stats=transportStats.get(id);send({type:'diagnostic',status:'连接诊断：音频通道关闭',detail:JSON.stringify({stream:id,...stats,lastPacketAt:undefined})});transportStats.delete(id);r.data.close();r.control.close();receivers.delete(id)}send({type:'audio-close',id})}
export function openMicUplink(key:Buffer,o:any){const id=nextId++;const socket=dgram.createSocket(o.phone.includes(':')?'udp6':'udp4');socket.on('error',()=>send({type:'status',status:'麦克风网络发送失败'}));microphones.set(id,{socket,key,opts:o,seq:0,timestamp:0,nonce:0n});send({type:'mic-open',id,opts:o});return id}
export function micPacket(id:number,data:Buffer,samples:number){const m=microphones.get(id);if(!m||data.length>65500||!Number.isInteger(samples)||samples<=0||samples>9600)return;const h=Buffer.alloc(12);h[0]=128;h[1]=m.opts.payloadType&127;h.writeUInt16BE(m.seq);h.writeUInt32BE(m.timestamp,4);const nonce=nonce64(m.nonce++);const sealed=chachaSeal(m.key,nonce,data,h.subarray(4));const packet=Buffer.concat([h,sealed,nonce.subarray(4)]);m.socket.send(packet,m.opts.port,m.opts.phone);m.seq=(m.seq+1)&65535;m.timestamp=(m.timestamp+samples)>>>0}
export function closeMicUplink(id:number){const m=microphones.get(id);if(m){m.socket.close();microphones.delete(id)}send({type:'mic-close',id})}
export function closeMedia(){for(const id of [...receivers.keys()])closeAudioReceiver(id);for(const id of [...microphones.keys()])closeMicUplink(id)}
