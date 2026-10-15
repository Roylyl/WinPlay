const os=require('node:os');
const {isIP}=require('node:net');
const {readNetworkMetadata}=require('./network-query.cjs');

const equalName=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const hasName=(names,name)=>names.some(n=>equalName(n,name));
function usableIPv4(address){
 return isIP(address)===4&&!/^(?:0\.|127\.|169\.254\.)/.test(address)&&address!=='255.255.255.255';
}
function summarizeTethering(states=[],failureCount=0){
 const valid=states.filter(state=>['On','Off','Unknown','InTransition'].includes(state));
 if(valid.includes('On'))return 'On';
 if(valid.includes('InTransition'))return 'InTransition';
 if(!valid.length)return 'unavailable';
 if(failureCount>0||valid.includes('Unknown')||valid.length!==states.length)return 'Unknown';
 return 'Off';
}

function candidates(addresses,adapters,privateNames=[],publicNames=[],tetheringState='unavailable'){
 // Keep not-yet-addressed adapters in the selector while Mobile Hotspot starts.
 const names=[...new Set([...Object.keys(addresses),...adapters.map(a=>a.name)])];
 const items=names.flatMap(name=>{
  const items=addresses[name]||[],adapter=adapters.find(a=>equalName(a.name,name));
  if(items.length&&items.every(a=>a.internal)||!adapter&&!items.some(a=>!a.internal))return [];
  const description=adapter?.description||'';
  if(/loopback/i.test(description))return [];
  const sharingRole=hasName(privateNames,name)?'private':hasName(publicNames,name)?'public':'';
  const virtualHotspot=/Wi-Fi Direct/i.test(description),hotspot=sharingRole==='private'||virtualHotspot;
  const selectableHotspot=hotspot&&!/tunnel|vpn|\btap\b|\btun\b|loopback|hyper-v|wireguard|tailscale|zerotier|vmware|hamachi|radmin|npcap/i.test(name+' '+description)&&(!/virtual/i.test(description)||virtualHotspot);
  const lan=(adapter?.physical===true||adapter?.physical===undefined&&adapter?.lanCandidate===true)&&!hotspot&&!/tunnel|vpn|\btap\b|\btun\b|virtual|loopback|hyper-v|wireguard|tailscale|zerotier|vmware|hamachi|radmin|npcap/i.test(name+' '+description);
  const ipv4=items.find(a=>!a.internal&&(a.family==='IPv4'||a.family===4)&&usableIPv4(a.address))?.address||'';
  const ipv6=items.some(a=>!a.internal&&(a.family==='IPv6'||a.family===6)&&/^fe80:/i.test(a.address));
  const linkReady=adapter?.up===true;
  const wireless=adapter?.wireless===true||adapter?.wireless===undefined&&/wi-?fi|wireless|802\.11/i.test(description);
  const defaultRoute=adapter?.defaultRoute===true;
  // A retained address alone cannot establish that a virtual downstream is up.
  const downstreamReady=selectableHotspot&&adapter?.up===true&&!!ipv4&&sharingRole!=='public'&&!defaultRoute;
  return [{name,ipv4,ipv6,hotspot,selectableHotspot,lan,activeHotspot:false,sharingRole,ready:linkReady&&!!(ipv4||ipv6),wireless,defaultRoute,routeMetric:Number.isFinite(adapter?.routeMetric)?adapter.routeMetric:Number.MAX_SAFE_INTEGER,virtualHotspot,downstreamReady,hotspotSource:''}];
 });
 // WinRT reads the current Mobile Hotspot state, while legacy ICS can omit its
 // private role. Never infer On from a stale Wi-Fi Direct IP, and never guess
 // between multiple ready virtual links. Explicit ICS private evidence wins.
 let possible=[];
 if(tetheringState==='On')possible=items.filter(item=>(item.virtualHotspot||item.sharingRole==='private')&&item.downstreamReady);
 else if(tetheringState==='unavailable'||tetheringState==='Unknown')possible=items.filter(item=>item.sharingRole==='private'&&item.downstreamReady);
 const explicit=possible.filter(item=>item.sharingRole==='private');
 const confirmed=explicit.length===1?explicit:explicit.length===0&&possible.length===1?possible:[];
 if(confirmed.length===1){confirmed[0].activeHotspot=true;confirmed[0].hotspotSource=confirmed[0].sharingRole==='private'?'ics':'winrt';}
 return items;
}

function recommendNetworks(items){
 const lans=items.filter(n=>n.lan&&n.ready).sort((a,b)=>
  Number(b.defaultRoute)-Number(a.defaultRoute)||Number(b.wireless)-Number(a.wireless)||
  a.routeMetric-b.routeMetric||a.name.localeCompare(b.name));
 return {hotspot:items.find(n=>n.activeHotspot)?.name||'',lan:lans[0]?.name||''};
}

function networkDiagnostic(snapshot,reason='',selectionReplaced=false){
 const items=snapshot.items||[],direct=items.filter(item=>item.virtualHotspot);
 return {
  state:snapshot.tetheringState||'unavailable',sharingAvailable:snapshot.sharingAvailable===true,
  source:items.find(item=>item.activeHotspot)?.hotspotSource||'',
  directCount:direct.length,readyDirectCount:direct.filter(item=>item.downstreamReady).length,
  privateCount:items.filter(item=>item.sharingRole==='private').length,
  activeCount:items.filter(item=>item.activeHotspot).length,
  ...(snapshot.sharingError?{sharingError:snapshot.sharingError}:{}),
  ...(snapshot.tetheringError?{tetheringError:snapshot.tetheringError}:{}),
  adapterCount:items.length,readyLanCount:items.filter(item=>item.lan&&item.ready).length,
  ...(snapshot.queries?{queries:snapshot.queries}:{}),
  reason,selectionReplaced
 };
}

function networkSnapshot(addresses,metadata={}){
 const tetheringState=summarizeTethering(metadata.tetheringStates||[],metadata.tetheringFailures||0);
 const items=candidates(addresses,metadata.adapters||[],metadata.privateNames||[],metadata.publicNames||[],tetheringState);
 const result={ok:true,items,sharingAvailable:metadata.sharingAvailable===true,sharingError:metadata.sharingError||metadata.errorCode||'',tetheringState,tetheringError:metadata.tetheringError||'',recommended:recommendNetworks(items),queries:metadata.queries,queryFailed:metadata.queryFailed===true};
 result.diagnostic=networkDiagnostic(result);
 return result;
}

async function listNetworks({timeoutMs=8000,mode,signal}={}){
 const metadata=await readNetworkMetadata({timeoutMs,mode,signal});
 return networkSnapshot(os.networkInterfaces(),metadata);
}

function resolveNetworkSelection(mode,name,snapshot){
 const items=snapshot.items||[],recommended=snapshot.recommended||{},chosen=name||recommended[mode]||'';
 const item=items.find(n=>equalName(n.name,chosen));
 const result=(value,reason=value.code||'',selectionReplaced=false)=>({...value,items,recommended,diagnostic:networkDiagnostic(snapshot,reason,selectionReplaced)});
 if(mode!=='hotspot'&&mode!=='lan')return result({ok:false,code:'NETWORK_MODE_INVALID',error:'请选择本机移动热点或现有局域网模式'});
 if(snapshot.queryFailed)return result({ok:false,code:'NETWORK_QUERY_FAILED',error:'Windows网络信息查询失败或超时，无法判断网卡状态。请刷新重试，并导出诊断日志'});
 if(mode==='hotspot'){
  const confirmed=items.filter(n=>n.activeHotspot),current=item?.activeHotspot?item:confirmed.length===1?confirmed[0]:undefined;
  if(current)return result({ok:true,name:current.name,item:current},'HOTSPOT_CONFIRMED',!!name&&!equalName(name,current.name));
  const unavailable=snapshot.sharingAvailable===false&&(snapshot.tetheringState||'unavailable')==='unavailable';
  const ambiguous=(snapshot.tetheringState==='On'?items.filter(n=>(n.virtualHotspot||n.sharingRole==='private')&&n.downstreamReady):items.filter(n=>n.sharingRole==='private'&&n.downstreamReady)).length>1;
  const code=snapshot.tetheringState==='Off'?'HOTSPOT_OFF':snapshot.tetheringState==='InTransition'?'HOTSPOT_TRANSITION':ambiguous?'HOTSPOT_INTERFACE_AMBIGUOUS':unavailable?'HOTSPOT_SHARING_UNAVAILABLE':'HOTSPOT_NOT_READY';
  const queryUnavailable=unavailable&&snapshot.queries?.some(q=>['sharing','tethering'].includes(q.stage)&&q.code!=='OK');
  const error=queryUnavailable?'Windows热点状态查询失败或超时，无法确认共享接口。请刷新重试，并导出诊断日志':code==='HOTSPOT_OFF'?'Windows移动热点未开启，请开启热点后重试':code==='HOTSPOT_TRANSITION'?'Windows移动热点正在启动，请等待共享接口就绪':code==='HOTSPOT_INTERFACE_AMBIGUOUS'?'检测到多个可能的热点接口，无法确认当前共享接口，请检查Windows移动热点设置后重试':unavailable||snapshot.tetheringState==='Unknown'?'无法确认Windows移动热点共享接口，请检查系统移动热点设置后重试':item&&!item.hotspot?'所选网卡不是Windows移动热点的共享接口，请自动检测或重新选择':'Windows移动热点尚未就绪，请开启热点并等待共享接口获得地址';
  return result({ok:false,code,error});
 }
 if(item?.lan&&item.ready)return result({ok:true,name:item.name,item},'LAN_CONFIRMED');
 return result({ok:false,code:'LAN_NOT_READY',error:item&&!item.lan?'所选网卡不是有效的局域网接口，请选择已连接Wi-Fi或以太网的物理网卡':'所选局域网接口尚未连接或没有可用地址，请检查网络连接'});
}

// Present the same selection that reception will use, without requiring users
// to identify Windows adapter aliases or treating a stale address as readiness.
function networkGuidance(mode,name,snapshot){
 const resolved=resolveNetworkSelection(mode,name,snapshot);
 const eligible=(snapshot.items||[]).filter(item=>mode==='hotspot'?(item.hotspot||item.sharingRole==='private')&&item.selectableHotspot!==false:mode==='lan'&&item.lan);
 const selected=resolved.item||eligible.find(item=>name&&equalName(item.name,name));
 const kind=item=>mode==='hotspot'?'hotspot':item.wireless?'wifi':'ethernet';
 const selection={ok:resolved.ok,automatic:!name,code:resolved.code||resolved.diagnostic.reason,
  ...(selected?{name:selected.name,kind:kind(selected)}:mode==='hotspot'?{kind:'hotspot'}:{}),
  ...(resolved.error?{error:resolved.error}:{}),selectionReplaced:resolved.diagnostic.selectionReplaced===true};
 const choices=eligible.map(item=>{
  const ready=!snapshot.queryFailed&&(mode==='hotspot'?item.activeHotspot===true:item.ready===true);
  return {name:item.name,kind:kind(item),ready,selected:!!selected&&equalName(item.name,selected.name),
   recommended:ready&&equalName(item.name,snapshot.recommended?.[mode]||'')};
 }).sort((a,b)=>Number(b.selected)-Number(a.selected)||Number(b.recommended)-Number(a.recommended)||Number(b.ready)-Number(a.ready)||a.name.localeCompare(b.name));
 return {selection,choices};
}

const abortResult=()=>({ok:false,code:'NETWORK_WAIT_CANCELLED',error:'网络检查已取消'});
function pause(ms,signal){return new Promise(resolve=>{
 let timer;const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',finish);resolve()};
 if(signal?.aborted){resolve();return}timer=setTimeout(finish,ms);signal?.addEventListener('abort',finish,{once:true});
})}
function createNetworkWaiter(read=listNetworks,sleep=pause){
 return async function waitForNetwork(mode,name,{timeoutMs=8000,onWait,signal}={}){
  const deadline=Date.now()+Math.max(0,timeoutMs);let last;
  do{
   if(signal?.aborted)return abortResult();
   const snapshot=await read({timeoutMs:Math.max(1,deadline-Date.now()),mode,signal});
   if(signal?.aborted)return abortResult();
   last=resolveNetworkSelection(mode,name,snapshot);
   if(last.ok||last.code==='NETWORK_QUERY_FAILED'||mode!=='hotspot'||Date.now()>=deadline)return last;
   onWait?.(last);
   await sleep(Math.min(500,Math.max(0,deadline-Date.now())),signal);
  }while(Date.now()<deadline);
  return last;
 }
}
const waitForNetwork=createNetworkWaiter();
module.exports={listNetworks,candidates,recommendNetworks,resolveNetworkSelection,networkGuidance,waitForNetwork,createNetworkWaiter,summarizeTethering,networkDiagnostic,networkSnapshot};
