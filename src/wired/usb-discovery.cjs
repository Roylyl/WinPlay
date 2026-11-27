'use strict';
const {nativePath}=require('./native-path.cjs');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {EventEmitter}=require('node:events');
const {createInterface}=require('node:readline');
const dns=require('dns-packet');
const {Discovery}=require('../../build/engine/discovery');
const {endpoint}=require('./usb-sockets.cjs');
function requestsUnicast(bytes,questions){
  let offset=12;
  for(let i=0;i<questions.length;i++){
    dns.question.decode(bytes,offset);
    offset+=dns.question.decode.bytes;
    if(bytes.readUInt16BE(offset-2)&0x8000)return true;
  }
  return false;
}

const service='_carplay-ctrl._tcp.local';
const dnsName=s=>typeof s==='string' && s.length<=255 ? s.toLowerCase().replace(/\.$/,'') : '';
function btId(value) {
  const s=String(value || '');
  return /^(?:[\da-f]{2}[:-]){5}[\da-f]{2}$/i.test(s) || /^[\da-f]{12}$/i.test(s) ? s.replace(/[:-]/g,'').toLowerCase() : '';
}
// Keep records from different link-local senders separate. The shared WinPlay
// discovery engine receives only a resolved service from the requested iPhone.
class ControlEvidence {
  constructor(index,phone){this.index=index;this.phone=btId(phone);this.senders=new Map();}
  observe(source,records,query) {
    const now=Date.now();
    let cached=this.senders.get(source);
    if(!cached) {
      if(this.senders.size>=24)this.senders.delete(this.senders.keys().next().value);
      this.senders.set(source,cached=new Map());
    }
    for(const [k,r] of cached)if(r.until<=now)cached.delete(k);
    for(const r of records) {
      const name=dnsName(r.name),instance=name.endsWith('.'+service);
      if(!name||!Number.isFinite(r.ttl)||r.ttl<0||r.class && r.class!=='IN')continue;
      const ptr=r.type==='PTR' && name===service && dnsName(r.data).endsWith('.'+service);
      const srv=r.type==='SRV' && instance && dnsName(r.data?.target).endsWith('.local') && Number.isInteger(r.data.port) && r.data.port>0 && r.data.port<=65535;
      const txt=r.type==='TXT' && instance && Array.isArray(r.data) && r.data.every(Buffer.isBuffer);
      const addr=r.type==='AAAA' && name.endsWith('.local') && endpoint(r.data,this.index)===source;
      if(!ptr&&!srv&&!txt&&!addr)continue;
      const key=r.type+'|'+name+(ptr?'|'+dnsName(r.data):'');
      if(r.ttl===0){cached.delete(key);continue;}
      if(!cached.has(key) && cached.size>=64)cached.delete(cached.keys().next().value);
      cached.set(key,{r,until:now+Math.min(r.ttl,120)*1000});
    }
    const found=[],instances=new Set();
    for(const {r} of cached.values()){
      if(r.type==='PTR')instances.add(dnsName(r.data));
      if(r.type==='SRV' || r.type==='TXT')instances.add(dnsName(r.name));
    }
    for(const instance of instances) {
      const srv=cached.get('SRV|'+instance),txt=cached.get('TXT|'+instance);
      if(!srv)query(instance,'SRV');
      if(!txt)query(instance,'TXT');
      if(!srv || !txt)continue;
      const ids=txt.r.data.map(b=>b.toString()).filter(v=>/^id=/i.test(v));
      if(!this.phone || ids.length!==1 || btId(ids[0].slice(3))!==this.phone)continue;
      const host=dnsName(srv.r.data.target);
      const address=cached.get('AAAA|'+host);
      if(!address){query(host,'AAAA');continue;}
      found.push({port:srv.r.data.port,until:Math.min(srv.until,txt.until,address.until),records:[srv.r,txt.r,address.r]});
    }
    return found;
  }
}

function startDiscovery(scope,identity,phone,allowed,onStage,onVerifiedPeer,onReady) {
  const known=new Set();
  const once=(stage,data={})=>{if(!known.has(stage)){known.add(stage);onStage(stage,data);}};
  const stats={sentQueries:0,sentAnnouncements:0,receivedQueries:0,receivedResponses:0,controlRecords:0,unrelatedResponses:0,gatewayResponses:0,otherAddressResponses:0,verifiedServiceResponses:0};
  const gateway=endpoint(scope.peer,scope.index),evidence=new ControlEvidence(scope.index,phone),verified=new Map(),followups=new Map();
  let confirmedControlQuery=false,discoveryReady=false,approvedPeer;
  const iface='selected-usb';
  const bind=(opt)=>{
    if(opt.type!=='udp6'||opt.interface!==scope.address)throw Error('WRONG_SCOPE');
    const io=new EventEmitter();
    const child=spawn(nativePath('WinPlay.UsbMdns.exe'),[String(scope.index)],
      {stdio:['pipe','pipe','ignore'],windowsHide:true});
    const pending=new Map();
    let seq=0,ready=false,closed=false,replyPort=0,replyId=0,replyAddress,legacyQuestions;
    function put(packet,mode,port,kind,cb=()=>{},destination=replyAddress||gateway){
      if(closed||!ready||pending.size>=48){cb(new Error('DNS_NOT_READY'));return;}
      const id=++seq;
      try{
        const bytes=dns.encode(packet);
        if(bytes.length>9000)throw Error('DNS_TOO_LARGE');
        if(mode==='U' && !destination)throw Error('NO_UNICAST_PEER');
        const controlQuery=kind==='query' && mode==='M' && packet.questions?.some(q=>dnsName(q.name)===service && q.type==='PTR');
        pending.set(id,{cb,kind,controlQuery});
        child.stdin.write(id+' '+mode+' '+port+' '+(mode==='U'?destination+'%'+scope.index:'-')+' '+bytes.toString('base64')+'\n');
      }catch(e){pending.delete(id);cb(e);}
    }
    io.respond=(p,cb)=>put({...p,...(legacyQuestions?{questions:legacyQuestions,answers:p.answers.map(a=>({...a,ttl:Math.min(10,a.ttl)}))}:{}),type:'response',flags:dns.AUTHORITATIVE_ANSWER,id:legacyQuestions?replyId:0},
      replyPort?'U':'M',replyPort||5353,'publish',cb);
    io.query=(p,cb)=>put({...p,type:'query'},'M',5353,'query',cb);
    io.destroy=()=>{if(closed)return;closed=true;child.stdin.end();child.kill();pending.clear();};
    child.stdin.on('error',()=>once('usb-mdns-bridge-write-error'));
    child.on('error',()=>once('usb-mdns-bridge-launch-error'));
    child.on('exit',code=>{if(!closed){once('usb-mdns-bridge-ended',{code});closed=true;}});
    createInterface({input:child.stdout}).on('line',line=>{
      if(closed)return;
      if(line==='READY'){
        ready=true;once('usb-mdns-interface-joined',{ifIndex:scope.index});io.emit('ready');
        const browse={type:'query',questions:[{name:'_services._dns-sd._udp.local',type:'PTR'}]};
        put(browse,'M',5353,'query');
        // Additional direct query reaches only the same USB peer, even when it
        // prefers answering unicast DNS-SD questions over a point-to-point link.
        if(gateway)put({type:'query',questions:[{name:service,type:'PTR'}]},'U',5353,'query');
        return;
      }
      const parts=line.split(' '),cmd=parts[0],id=Number(parts[1]);
      if(cmd==='TX'||cmd==='TXERR'){
        const task=pending.get(id);if(!task)return;pending.delete(id);
        if(cmd==='TX'){
          if(task.kind==='query'){stats.sentQueries++;once('usb-mdns-query-sent');}
          else{stats.sentAnnouncements++;once('usb-mdns-airplay-published');}
          if(task.controlQuery)confirmedControlQuery=true;
          if(!discoveryReady && confirmedControlQuery && stats.sentAnnouncements){
            discoveryReady=true;once('usb-mdns-discovery-ready');onReady?.();
          }
          task.cb();
        }else{once('usb-mdns-send-failed',{code:Number(parts[2])||0});task.cb(Object.assign(Error('DNS_SEND_FAILED'),{code:'DNS_SEND_FAILED'}));}
        return;
      }
      if(cmd==='ERR'){once('usb-mdns-'+(['scope','bind','join','argument'].includes(parts[1])?parts[1]:'startup')+'-failed',{code:Number(parts[2])||0});return;}
      if(cmd==='RXERR'){once('usb-mdns-read-failed',{code:id});return;}
      if(cmd!=='RX'||parts.length!==4||!Number.isInteger(id)||id<1||id>65535)return;
      const source=endpoint(parts[2],scope.index);
      if(!source||source===scope.local)return;
      const bytes=Buffer.from(parts[3],'base64');
      let p;try{p=dns.decode(bytes);}catch{return;}
      if(p.type==='response'){
        if(id!==5353)return;
        stats.receivedResponses++;once('usb-peer-mdns-response');
        if(source===gateway)stats.gatewayResponses++;else stats.otherAddressResponses++;
        const records=[...(p.answers||[]),...(p.additionals||[])];
        const isCtrl=r=>typeof r.name==='string' && /(?:^|\.)_carplay-ctrl\._tcp\.local\.?$/i.test(r.name);
        if(records.some(isCtrl)){stats.controlRecords++;once('usb-phone-carplay-control-advertised');}
        else {stats.unrelatedResponses++;once('usb-peer-other-mdns-response');}
        const checked=evidence.observe(source,records,(name,type)=>{
          const key=type+'|'+name,now=Date.now();
          if((followups.get(key)||0)>now)return;
          if(followups.size>=128)followups.delete(followups.keys().next().value);
          followups.set(key,now+1500);io.query({questions:[{name,type}]});
        });
        if(verified.has(source))verified.delete(source);
        if(checked.length) {
          if(verified.size>=24)verified.delete(verified.keys().next().value);
          verified.set(source,checked);
          stats.verifiedServiceResponses++;once('usb-phone-carplay-control-identity-matched');
          io.emit('response',{answers:checked.flatMap(s=>s.records)});
        }
      }else if(p.type==='query'){
        stats.receivedQueries++;once('usb-peer-mdns-query');
        const knownPeer=source===gateway || source===approvedPeer;
        // A new phone can browse the receiver first. On this USB interface an
        // ordinary 5353 query may elicit a public multicast announcement. Never
        // direct unicast traffic to the unverified source.
        if(id!==5353 && !knownPeer)return;
        // dns-packet 5 omits the QU bit when returning decoded questions.
        try{replyPort=knownPeer && (id!==5353 || requestsUnicast(bytes,p.questions))?id:0;}catch{return;}
        legacyQuestions=id!==5353?p.questions:undefined;replyId=p.id||0;replyAddress=source;
        try{io.emit('query',p);}finally{legacyQuestions=undefined;replyId=0;replyPort=0;replyAddress=undefined;}
      }
    });
    return io;
  };
  const connect=options=>{
    const target=endpoint(options.host,scope.index);
    if(!target || endpoint(options.localAddress,scope.index)!==scope.local ||
       !verified.get(target)?.some(s=>s.port===options.port && s.until>Date.now()) ||
       (target!==gateway && onVerifiedPeer?.(target)!==true))
      throw Object.assign(Error('Peer mismatch'),{code:'EPERM'});
    approvedPeer=target;
    once('usb-carplay-reverse-http-connect');
    return net.createConnection({host:target+'%'+scope.index,localAddress:scope.address,family:6,port:options.port});
  };
  const discovery=new Discovery(iface,identity,phone,allowed,s=>{
    const status=/HTTP(\d{3})/.exec(s);
    if(status)once('usb-carplay-reverse-http-'+status[1]);
    if(s.includes('忽略非所选设备'))once('usb-mdns-other-phone-identity');
    if(s.includes('控制探测失败'))once('usb-carplay-reverse-http-failed');
  },{interfaces:()=>({[iface]:[{address:scope.local,family:'IPv6',scopeid:scope.index,internal:false}]}),mdns:bind,connect});
  return {stop(){onStage('usb-mdns-summary',{...stats,...discovery.summary()});discovery.destroy();}};
}
module.exports={startDiscovery,ControlEvidence};
