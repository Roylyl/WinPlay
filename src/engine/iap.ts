// iAP2 link/CSM port derived from MacPlay's iap2-link and AndroidPlay's
// Iap2WirelessControlClient. Header and payload each have an additive checksum.
import { EventEmitter } from 'node:events'
import type { Duplex } from 'node:stream'
import type { MfiSigner } from './protocol/mfiSigner'
export const marker=Buffer.from('ff550200ee10','hex')
export const u16=(n:number)=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b}
export const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(n>>>0);return b}
export const str=(s:string)=>Buffer.from(s+'\0')
export function param(id:number,data:Buffer=Buffer.alloc(0)):Buffer{return Buffer.concat([u16(data.length+4),u16(id),data])}
export function csm(id:number,params:Buffer[]=[]) {const data=Buffer.concat(params);return Buffer.concat([Buffer.from('4040','hex'),u16(data.length+6),u16(id),data])}
export function fields(b:Buffer):Map<number,Buffer>{const result=new Map<number,Buffer>();for(let i=0;i+4<=b.length;){const len=b.readUInt16BE(i);if(len<4||i+len>b.length)throw new Error('iAP2参数长度无效');result.set(b.readUInt16BE(i+2),b.subarray(i+4,i+len));i+=len}return result}
export function checksum(b:Buffer){return (-b.reduce((sum,n)=>sum+n,0))&255}
export function packet(control:number,seq:number,ack:number,session:number,data?:Buffer){const h=Buffer.alloc(9);h.writeUInt16BE(0xff5a);h.writeUInt16BE(data?data.length+10:9,2);h[4]=control;h[5]=seq;h[6]=ack;h[7]=session;h[8]=checksum(h.subarray(0,8));return data?Buffer.concat([h,data,Buffer.from([checksum(data)])]):h}
type Pending={seq:number;session:number;data:Buffer;time:number;retries:number}
export class IapLink extends EventEmitter {
 private buffer=Buffer.alloc(0);private csmbuf=Buffer.alloc(0);private seq=99;private ack=0;private state='detect'
 private pending:Pending[]=[];private queue:{session:number;data:Buffer}[]=[];private outOfOrder=new Map<number,{session:number;data:Buffer}>()
 private timer:NodeJS.Timeout;private writer:(b:Buffer)=>void;private lastNegotiate=0;private began=Date.now()
 private maxOutgoing=30;private maxLen=65535;private timeout=4000;private maxRetries=4
 constructor(private stream:Duplex,private options={initiate:false,zeroAck:false}){super();this.writer=b=>stream.write(b);stream.on('data',b=>this.feed(b));stream.on('error',()=>this.fail('iAP2传输错误'));stream.on('close',()=>{if(this.state!=='dead')this.emit('transport-closed')});this.writer(marker);this.timer=setInterval(()=>this.tick(),100);if(options.initiate){this.state='negotiate';this.sync()}}
 setWriter(writer:(b:Buffer)=>void){this.writer=writer}
 private sync(){const payload=Buffer.from(this.options.zeroAck?[1,4,255,255,0,0,0,0,0,0,10,0,2,11,2,1,12,1,2]:[1,4,255,255,15,160,1,244,4,3,10,0,2,11,2,1,12,1,2]);this.writer(packet(128,this.seq,this.ack,0,payload));this.lastNegotiate=Date.now()}
 private fail(reason:string){if(this.state==='dead')return;this.close();this.emit('failed',reason)}
 private tick(){const now=Date.now();if(this.state==='detect'){if(now-this.began>15000)return this.fail('iAP2检测超时');if(now-this.lastNegotiate>1000){this.writer(marker);this.lastNegotiate=now}}else if(this.state==='negotiate'){if(now-this.began>20000)return this.fail('iAP2链路协商超时');if(now-this.lastNegotiate>500)this.sync()}else if(this.state==='normal'){for(const p of this.pending){if(now-p.time>=this.timeout){if(++p.retries>this.maxRetries)return this.fail('iAP2确认超时');p.time=now;this.writer(packet(64,p.seq,this.ack,p.session,p.data))}}}}
 feed(chunk:Buffer){if(this.state==='dead')return;this.buffer=Buffer.concat([this.buffer,chunk]);if(this.buffer.length>2*1024*1024)return this.fail('iAP2接收缓冲超限');
  if(this.state==='detect'){if(this.buffer.length<6)return;if(!this.buffer.subarray(0,6).equals(marker))return this.fail('设备未回应iAP2检测标记');this.buffer=this.buffer.subarray(6);this.state='negotiate';this.sync()}
  if(this.state==='negotiate'&&this.buffer.length>=6&&this.buffer.subarray(0,6).equals(marker))this.buffer=this.buffer.subarray(6)
  while(this.buffer.length>=9){if(this.buffer.readUInt16BE(0)!==0xff5a){this.buffer=this.buffer.subarray(1);continue}const len=this.buffer.readUInt16BE(2);if(len<9)return this.fail('iAP2包长度无效');if(this.buffer.length<len)return;const b=this.buffer.subarray(0,len);this.buffer=this.buffer.subarray(len);if(checksum(b.subarray(0,9))!==0||len>9&&checksum(b.subarray(9))!==0)continue;
   const ctrl=b[4],seq=b[5],ack=b[6],sid=b[7],data=len>9?b.subarray(9,-1):undefined;
   if(ctrl&16)return this.fail('iPhone重置iAP2链路');
   if(ctrl&128){if(!data||data.length<10||data[0]!==1)return this.fail('无效的iAP2同步参数');this.maxOutgoing=Math.max(1,Math.min(64,data[1]));this.maxLen=Math.max(64,data.readUInt16BE(2));this.timeout=data.readUInt16BE(4);this.maxRetries=data[8];this.ack=seq;this.writer(packet(64,this.seq,this.ack,0))}
   if(ctrl&64){this.pending=this.pending.filter(p=>((ack-p.seq)&255)>127);if(this.state==='negotiate'){this.state='normal';this.emit('ready')}this.flush()}
   if(ctrl&32&&data){for(const p of this.pending){if(!data.includes(p.seq)){this.writer(packet(64,p.seq,this.ack,p.session,p.data));p.time=Date.now()}}}
   if((ctrl&~64)===0&&data){const distance=(seq-this.ack)&255;if(distance===1){this.ack=seq;this.deliver(sid,data);while(this.outOfOrder.has((this.ack+1)&255)){const next=(this.ack+1)&255,v=this.outOfOrder.get(next)!;this.outOfOrder.delete(next);this.ack=next;this.deliver(v.session,v.data)}}else if(distance>1&&distance<128&&this.outOfOrder.size<64){this.outOfOrder.set(seq,{session:sid,data});this.writer(packet(32,this.seq,this.ack,0,Buffer.from([...this.outOfOrder.keys()])))}this.writer(packet(64,this.seq,this.ack,0))}
  }
 }
 private deliver(sid:number,data:Buffer){if(sid===12){this.emit('file',data);return}if(sid!==10)return;this.csmbuf=Buffer.concat([this.csmbuf,data]);while(this.csmbuf.length>=6){if(this.csmbuf.readUInt16BE(0)!==0x4040)return this.fail('iAP2控制消息标记无效');const len=this.csmbuf.readUInt16BE(2);if(len<6)return this.fail('iAP2控制消息长度无效');if(this.csmbuf.length<len)return;const b=this.csmbuf.subarray(0,len);this.csmbuf=this.csmbuf.subarray(len);this.emit('csm',b.readUInt16BE(4),fields(b.subarray(6)))}}
 send(data:Buffer,session=10){if(this.state==='dead')throw new Error('iAP2链路已关闭');const size=this.maxLen-10;for(let i=0;i<data.length;i+=size)this.queue.push({session,data:data.subarray(i,i+size)});if(this.queue.length>256)return this.fail('iAP2发送缓冲超限');this.flush()}
 private flush(){if(this.state!=='normal')return;while(this.queue.length&&this.pending.length<this.maxOutgoing){const q=this.queue.shift()!;this.seq=(this.seq+1)&255;const p={...q,seq:this.seq,time:Date.now(),retries:0};if(this.timeout>0)this.pending.push(p);this.writer(packet(64,this.seq,this.ack,q.session,q.data))}}
 close(){this.state='dead';clearInterval(this.timer);this.pending=[];this.queue=[];this.stream.destroy()}
}
export type Handoff={ssid:string;password:string;channel:number;btMac:string;apMac:string;host:string;port:number;pk:string;serial:string}
const text=(b?:Buffer)=>b?.toString('utf8').replace(/\0.*$/s,'')||''
export function identification(cfg:Handoff){
 const sent=[0xaa01,0xaa03,0x5000,0x5002,0x5003,0x5200,0x5203,0xae00,0xae02,0x4157,0x4159,0x4154,0x4156,0x4301,0x5703]
 const received=[0xaa00,0xaa02,0xaa04,0xaa05,0xea00,0xea01,0x5001,0x5201,0x5202,0xae01,0x4158,0x4155,0x4300,0x4e0d,0x4e0e,0x5702]
 const p=[...['WinPlay','WinPlay','Roylyl',cfg.serial,'1.1.0','1.0'].map((s,i)=>param(i,str(s))),param(6,Buffer.concat(sent.map(u16))),param(7,Buffer.concat(received.map(u16))),param(8,Buffer.from([0])),param(9,u16(20)),param(10,Buffer.concat([param(0,Buffer.from([1])),param(1,str('io.github.roylyl.winplay')),param(2,Buffer.from([0]))])),param(12,str('en')),param(13,str('en'))]
 p.push(param(17,Buffer.concat([param(0,u16(0)),param(1,str('blue')),param(2),param(3,Buffer.from(cfg.btMac.replaceAll(':',''),'hex')),param(4,str('blue')),param(5)])),param(24,Buffer.concat([param(0,u16(1)),param(1,str(cfg.ssid)),param(2),param(3,u16(1)),param(4),param(5)])))
 return csm(0x1d01,p)
}
export class Accessory extends EventEmitter {
 authenticated=false;private stage='identify';private preWifi=0;private postWifi=0;private transportNotified=false;private deadline:NodeJS.Timeout
 constructor(public link:IapLink,private signer:MfiSigner,private cfg:Handoff){super();link.on('csm',(id,p)=>{this.receive(id,p).catch((e:Error)=>this.emit('failed',e.message||'iAP2认证或消息处理失败'))});link.on('failed',s=>this.emit('failed',s));this.deadline=setTimeout(()=>this.emit('failed','配件识别或认证超时'),45000)}
 private send(id:number,p:Buffer[]=[]){this.link.send(csm(id,p))}
 private wifi(){const count=this.transportNotified?this.postWifi:this.preWifi;if(count>=3)return;if(this.transportNotified)this.postWifi++;else this.preWifi++;this.send(0x5703,[param(1,str(this.cfg.ssid)),param(2,str(this.cfg.password)),param(3,Buffer.from([2])),param(4,Buffer.from([this.cfg.channel]))])}
 async startCarPlay(){if(!this.authenticated)return;const c=this.cfg;const group=[param(0,str(c.ssid)),param(1,str(c.password)),param(2,Buffer.from([c.channel])),param(3,str(c.host)),param(4,Buffer.from([2]))];this.send(0x4301,[param(1,Buffer.concat(group)),param(2,u32(c.port)),param(3,str(c.apMac)),param(4,str(c.pk)),param(5,str('950.7.1'))]);this.emit('negotiation')}
 private async receive(id:number,p:Map<number,Buffer>){
  if(id===0x1d00){this.link.send(identification(this.cfg));return}
  if(id===0x1d03){this.emit('failed','iPhone拒绝配件识别参数：'+[...p.keys()].join(','));return}
  if(id===0x1d02){this.stage='authenticate';this.emit('status','iPhone已接受配件识别');return}
  if(id===0xaa00&&this.stage==='authenticate'){this.send(0xaa01,[param(0,await this.signer.certificate())]);return}
  if(id===0xaa02&&this.stage==='authenticate'){const challenge=p.get(0);if(!challenge||challenge.length!==32)throw new Error('挑战长度错误');this.send(0xaa03,[param(0,await this.signer.sign(challenge))]);return}
  if(id===0xaa04){this.emit('failed','iPhone拒绝MFi认证材料');return}
  if(id===0xaa05&&this.stage==='authenticate'){this.authenticated=true;this.stage='ready';clearTimeout(this.deadline);this.emit('status','MFi认证已通过，等待CarPlay请求');
   this.send(0x5000,[param(0,Buffer.concat([0,1,4,6,12,26].map(n=>param(n)))),param(1,Buffer.concat([0,1,7,12,13,16].map(n=>param(n))))]);
   this.send(0x5200);this.send(0xae00,[param(3),param(4),param(5)]);this.send(0x4157,[param(0),param(3),param(4)]);this.send(0x4154,[param(0),param(1),param(2),param(3),param(4),param(10)]);return}
  if(!this.authenticated)return
  if(id===0x5702)this.wifi()
  if(id===0x4e0e){this.transportNotified=true;this.wifi()}
  if(id===0x4300)await this.startCarPlay()
  if(id===0x5001)this.emit('now-playing',p)
 }
 seek(ms:number){this.send(0x5003,[param(0,u32(ms))])}
 close(){clearTimeout(this.deadline);this.link.close()}
}
export {text as iapText}
