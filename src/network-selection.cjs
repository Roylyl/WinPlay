const os=require('node:os');
const {isIP}=require('node:net');
const {execFile}=require('node:child_process');

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
  const lan=!!adapter?.physical&&!hotspot&&!/tunnel|vpn|tap|virtual|loopback|hyper-v|wireguard/i.test(description);
  const ipv4=items.find(a=>!a.internal&&(a.family==='IPv4'||a.family===4)&&usableIPv4(a.address))?.address||'';
  const ipv6=items.some(a=>!a.internal&&(a.family==='IPv6'||a.family===6)&&/^fe80:/i.test(a.address));
  const linkReady=adapter?.up===true;
  const wireless=adapter?.wireless===true||adapter?.wireless===undefined&&/wi-?fi|wireless|802\.11/i.test(description);
  const defaultRoute=adapter?.defaultRoute===true;
  // A retained address alone cannot establish that a virtual downstream is up.
  const downstreamReady=adapter?.up===true&&!!ipv4&&sharingRole!=='public'&&!defaultRoute&&!/tunnel|vpn|tap|loopback|hyper-v|wireguard/i.test(description);
  return [{name,ipv4,ipv6,hotspot,lan,activeHotspot:false,sharingRole,ready:linkReady&&!!(ipv4||ipv6),wireless,defaultRoute,routeMetric:Number.isFinite(adapter?.routeMetric)?adapter.routeMetric:Number.MAX_SAFE_INTEGER,virtualHotspot,downstreamReady,hotspotSource:''}];
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
  Number(b.wireless)-Number(a.wireless)||Number(b.defaultRoute)-Number(a.defaultRoute)||
  a.routeMetric-b.routeMetric||Number(b.ipv6)-Number(a.ipv6)||a.name.localeCompare(b.name));
 return {hotspot:items.find(n=>n.activeHotspot)?.name||'',lan:lans[0]?.name||''};
}

// ICS roles are matched by interface GUID, then converted to the current alias.
// No SSID, password, phone identity or personal network configuration is read.
const metadataScript=String.raw`
$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$interfaces=@();$defaults=@()
try{$interfaces=@(Get-NetIPInterface -ErrorAction Stop);$defaults=@(Get-NetRoute -DestinationPrefix '0.0.0.0/0','::/0' -ErrorAction Stop)}catch{}
$adapters=@(Get-NetAdapter -IncludeHidden -ErrorAction Stop | ForEach-Object {
 $adapter=$_;$bestMetric=$null
 foreach($route in $defaults){
  if($route.InterfaceIndex -ne $adapter.InterfaceIndex){continue}
  $interface=$interfaces | Where-Object {$_.InterfaceIndex -eq $route.InterfaceIndex -and $_.AddressFamily -eq $route.AddressFamily} | Select-Object -First 1
  $metric=[long]$route.RouteMetric+[long]$interface.InterfaceMetric
  if($null -eq $bestMetric -or $metric -lt $bestMetric){$bestMetric=$metric}
 }
 @{name=$adapter.Name;description=$adapter.InterfaceDescription;physical=$adapter.HardwareInterface;guid=[string]$adapter.InterfaceGuid;up=($adapter.InterfaceOperationalStatus -eq 1);wireless=($adapter.NdisPhysicalMedium -eq 9 -or $adapter.NdisPhysicalMedium -eq 1);defaultRoute=($null -ne $bestMetric);routeMetric=$bestMetric}
})
$tetheringStates=@();$tetheringFailures=0;$tetheringError=''
try {
 Add-Type -AssemblyName System.Runtime.WindowsRuntime
 [void][Windows.Networking.Connectivity.NetworkInformation,Windows,ContentType=WindowsRuntime]
 [void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows,ContentType=WindowsRuntime]
 $profiles=@([Windows.Networking.Connectivity.NetworkInformation]::GetConnectionProfiles())
 $preferred=[Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
 if($preferred){$profiles=@($preferred)+$profiles}
 foreach($profile in $profiles){
  try {
   if([string]$profile.GetNetworkConnectivityLevel() -eq 'None'){continue}
   $manager=[Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
   $state=[string]$manager.TetheringOperationalState;$tetheringStates+=$state
   if($state -eq 'On'){break}
  }catch{$tetheringFailures++;if(-not $tetheringError){$tetheringError='TETHERING/'+$_.Exception.HResult}}
 }
}catch{$tetheringFailures++;$tetheringError='TETHERING/'+$_.Exception.HResult}
$private=@();$public=@();$sharingAvailable=$false;$sharingError=''
try {
 $sharing=New-Object -ComObject HNetCfg.HNetShare
 foreach($connection in $sharing.EnumEveryConnection){
  $configuration=$sharing.INetSharingConfigurationForINetConnection($connection)
  if(-not $configuration.SharingEnabled){continue}
  $properties=$sharing.NetConnectionProps($connection)
  $adapter=$adapters | Where-Object {$_.guid.Trim('{}') -eq ([string]$properties.Guid).Trim('{}')} | Select-Object -First 1
  $name=if($adapter){$adapter.name}else{$properties.Name}
  if($configuration.SharingConnectionType -eq 1){$private+=$name}else{$public+=$name}
 }
 $sharingAvailable=$true
}catch{$sharingError='ICS/'+$_.Exception.HResult}
@{adapters=$adapters;privateNames=$private;publicNames=$public;sharingAvailable=$sharingAvailable;sharingError=$sharingError;tetheringStates=$tetheringStates;tetheringFailures=$tetheringFailures;tetheringError=$tetheringError}|ConvertTo-Json -Depth 4 -Compress
`;

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
  reason,selectionReplaced
 };
}

function networkSnapshot(addresses,metadata={}){
 const tetheringState=summarizeTethering(metadata.tetheringStates||[],metadata.tetheringFailures||0);
 const items=candidates(addresses,metadata.adapters||[],metadata.privateNames||[],metadata.publicNames||[],tetheringState);
 const result={ok:true,items,sharingAvailable:metadata.sharingAvailable===true,sharingError:metadata.sharingError||metadata.errorCode||'',tetheringState,tetheringError:metadata.tetheringError||'',recommended:recommendNetworks(items)};
 result.diagnostic=networkDiagnostic(result);
 return result;
}

async function listNetworks({timeoutMs=8000}={}){
 const metadata=await new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',metadataScript],{windowsHide:true,timeout:Math.max(1,timeoutMs),maxBuffer:1024*1024},(error,out)=>{
  try{resolve(error?{errorCode:error.code||'NETWORK_QUERY_FAILED'}:JSON.parse(out))}catch{resolve({errorCode:'NETWORK_QUERY_FAILED'})}
 }));
 return networkSnapshot(os.networkInterfaces(),metadata);
}

function resolveNetworkSelection(mode,name,snapshot){
 const items=snapshot.items||[],recommended=snapshot.recommended||{},chosen=name||recommended[mode]||'';
 const item=items.find(n=>equalName(n.name,chosen));
 const result=(value,reason=value.code||'',selectionReplaced=false)=>({...value,items,recommended,diagnostic:networkDiagnostic(snapshot,reason,selectionReplaced)});
 if(mode!=='hotspot'&&mode!=='lan')return result({ok:false,code:'NETWORK_MODE_INVALID',error:'请选择本机移动热点或现有局域网模式'});
 if(mode==='hotspot'){
  const confirmed=items.filter(n=>n.activeHotspot),current=item?.activeHotspot?item:confirmed.length===1?confirmed[0]:undefined;
  if(current)return result({ok:true,name:current.name,item:current},'HOTSPOT_CONFIRMED',!!name&&!equalName(name,current.name));
  const unavailable=snapshot.sharingAvailable===false&&(snapshot.tetheringState||'unavailable')==='unavailable';
  const ambiguous=(snapshot.tetheringState==='On'?items.filter(n=>(n.virtualHotspot||n.sharingRole==='private')&&n.downstreamReady):items.filter(n=>n.sharingRole==='private'&&n.downstreamReady)).length>1;
  const code=snapshot.tetheringState==='Off'?'HOTSPOT_OFF':snapshot.tetheringState==='InTransition'?'HOTSPOT_TRANSITION':ambiguous?'HOTSPOT_INTERFACE_AMBIGUOUS':unavailable?'HOTSPOT_SHARING_UNAVAILABLE':'HOTSPOT_NOT_READY';
  const error=code==='HOTSPOT_OFF'?'Windows移动热点未开启，请开启热点后重试':code==='HOTSPOT_TRANSITION'?'Windows移动热点正在启动，请等待共享接口就绪':code==='HOTSPOT_INTERFACE_AMBIGUOUS'?'检测到多个可能的热点接口，无法确认当前共享接口，请检查Windows移动热点设置后重试':unavailable||snapshot.tetheringState==='Unknown'?'无法确认Windows移动热点共享接口，请检查系统移动热点设置后重试':item&&!item.hotspot?'所选网卡不是Windows移动热点的共享接口，请自动检测或重新选择':'Windows移动热点尚未就绪，请开启热点并等待共享接口获得地址';
  return result({ok:false,code,error});
 }
 if(item?.lan&&item.ready)return result({ok:true,name:item.name,item},'LAN_CONFIRMED');
 return result({ok:false,code:'LAN_NOT_READY',error:item&&!item.lan?'所选网卡不是有效的局域网接口，请选择已连接Wi-Fi或以太网的物理网卡':'所选局域网接口尚未连接或没有可用地址，请检查网络连接'});
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
   const snapshot=await read({timeoutMs:Math.max(1,deadline-Date.now())});
   if(signal?.aborted)return abortResult();
   last=resolveNetworkSelection(mode,name,snapshot);
   if(last.ok||mode!=='hotspot'||Date.now()>=deadline)return last;
   onWait?.(last);
   await sleep(Math.min(500,Math.max(0,deadline-Date.now())),signal);
  }while(Date.now()<deadline);
  return last;
 }
}
const waitForNetwork=createNetworkWaiter();
module.exports={listNetworks,candidates,recommendNetworks,resolveNetworkSelection,waitForNetwork,createNetworkWaiter,summarizeTethering,networkDiagnostic,networkSnapshot};
