// SPDX-License-Identifier: GPL-3.0-or-later
class PassiveReconnect{
 constructor({attempt,onWait=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){Object.assign(this,{attempt,onWait,setTimer,clearTimer});this.active=false;this.count=0;this.generation=0;this.busy=false;this.pending=false;this.timer=undefined}
 retry(){this.active=true;if(this.timer!==undefined)return;if(this.busy){this.pending=true;return}const seconds=[5,10,20,30,60][Math.min(this.count,4)],generation=this.generation;this.count++;this.onWait(seconds,this.count);this.timer=this.setTimer(async()=>{this.timer=undefined;if(!this.active||generation!==this.generation)return;this.busy=true;try{await this.attempt()}catch{if(generation===this.generation)this.pending=true}finally{this.busy=false;if(this.active&&this.pending){this.pending=false;this.retry()}}},seconds*1000)}
 cancel(){this.active=false;this.pending=false;this.count=0;this.generation++;if(this.timer!==undefined)this.clearTimer(this.timer);this.timer=undefined}
}
module.exports={PassiveReconnect};
