// SPDX-License-Identifier: GPL-3.0-or-later
const {spawn}=require('node:child_process');const {createInterface}=require('node:readline');
class SystemMedia {
 constructor(executable,onCommand,onError){this.ready=false;this.pending=[];this.process=spawn(executable,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});this.process.stdin.on('error',()=>{});createInterface({input:this.process.stdout}).on('line',line=>{try{const m=JSON.parse(line);if(m.type==='ready'){this.ready=true;for(const item of this.pending)this.write(item);this.pending=[]}else if(m.type==='command')onCommand(m);else if(m.type==='error')onError(m.reason)}catch{}});let error='';this.process.stderr.on('data',b=>error=(error+b).slice(-300));this.process.on('error',()=>onError('系统媒体桥接无法启动'));this.process.on('exit',code=>{this.ready=false;if(code&&!this.closing)onError(error||'系统媒体桥接已退出')})}
 write(m){if(this.process.stdin.writable)this.process.stdin.write(JSON.stringify(m)+'\n')}
 send(m){if(this.closing)return;if(this.ready)this.write(m);else{if(this.pending.length>=32)this.pending.shift();this.pending.push(m)}}
 update(state,artChanged){this.send({...state,command:'update',artChanged:!!artChanged,artwork:artChanged&&state.artwork?.length?Buffer.from(state.artwork).toString('base64'):''})}
 position(positionMs){this.send({command:'position',positionMs})}
 clear(){this.send({command:'clear'})}
 close(){this.closing=true;this.process.stdin.end(JSON.stringify({command:'stop'})+'\n');const child=this.process;setTimeout(()=>{if(child.exitCode===null)child.kill()},1500).unref()}
}
module.exports={SystemMedia};
