// Developer-only synthetic screen transport fixture. No phone credentials.
import net from 'node:net'
import {randomBytes} from 'node:crypto'
import {ScreenStream} from './protocol/screenStream'
import {chachaSeal,nonce64} from './protocol/crypto'
const send=(m:any)=>process.send?.(m);console.log=()=>{};console.warn=()=>{}
let stream:ScreenStream,socket:net.Socket,interval:NodeJS.Timeout,counter=0n,frames:any[],index=0
process.on('message',async(m:any)=>{if(m.command==='fixture'){const key=randomBytes(32);stream=new ScreenStream(key);stream.on('config',data=>send({type:'video-config',data,width:1280,height:720}));stream.on('frame',data=>send({type:'video-frame',data,timestamp:Number(process.hrtime.bigint()/1000n)}));const port=await stream.listen();socket=net.connect({port,host:'127.0.0.1'});await new Promise(resolve=>socket.once('connect',resolve));const config=Buffer.from(m.config),h=Buffer.alloc(128);h.writeUInt32LE(config.length);h[4]=1;socket.write(Buffer.concat([h,config]));frames=m.frames;const write=()=>{const payload=Buffer.from(frames[index++%frames.length]),head=Buffer.alloc(128);head.writeUInt32LE(payload.length+16);socket.write(Buffer.concat([head,chachaSeal(key,nonce64(counter++),payload,head)]))};write();interval=setInterval(write,1000/30)}
 if(m.command==='reconfigure'){const config=Buffer.from(m.config),h=Buffer.alloc(128);h.writeUInt32LE(config.length);h[4]=1;frames=m.frames;index=0;socket.write(Buffer.concat([h,config]))}
 if(m.command==='stop'){clearInterval(interval);stream?.stop();socket?.destroy();send({type:'stopped'});setTimeout(()=>process.exit(0),100)}
});process.on('disconnect',()=>process.exit(0));
