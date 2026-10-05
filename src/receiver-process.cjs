// SPDX-License-Identifier: GPL-3.0-or-later
// Retire the old worker before another receiver binds its listening ports.
function retireReceiver(proc,{graceMs=1500,killWaitMs=1000}={}){
 if(!proc||proc.exitCode!=null||proc.signalCode!=null)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  let timer,finished=false;
  const done=error=>{if(finished)return;finished=true;clearTimeout(timer);proc.removeListener('exit',onExit);error?reject(error):resolve()};
  const onExit=()=>done();proc.once('exit',onExit);
  timer=setTimeout(()=>{try{proc.kill()}catch(error){done(error);return}if(!finished)timer=setTimeout(()=>done(Error('旧接收进程尚未退出，请稍后重新启动接收')),killWaitMs)},graceMs);
  if(proc.connected){try{proc.send({command:'stop'},()=>{})}catch{/* A closing IPC channel is followed by exit or the bounded kill. */}}
 });
}
module.exports={retireReceiver};
