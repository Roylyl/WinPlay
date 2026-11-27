const {execFile}=require('node:child_process');
const {readHotspotConfiguration}=require('./mobile-hotspot-reader.cjs');
const {listNetworks,resolveNetworkSelection}=require('./network-selection.cjs');
function parseWlanConnection(output, includePassword) {
 try {
  const value=JSON.parse(output);
  if(!value?.ok) return {ok:false,...(Number.isInteger(value?.code)?{code:value.code}:{})};
  if(typeof value.interfaceName!=='string'||!value.interfaceName||typeof value.ssidHex!=='string'||!/^(?:[0-9a-f]{2}){1,32}$/i.test(value.ssidHex)) return {ok:false};
  // The radio reports octets. Never compare a lossy console rendering to user input.
  const ssid=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(value.ssidHex,'hex'));
  if(ssid.includes('\0')) return {ok:false};
  return {ok:true,ssid,interfaceName:value.interfaceName,channel:value.channel,bssid:value.bssid,
   ...(includePassword && typeof value.password==='string' && value.password ? {password:value.password} : {})};
 } catch { return {ok:false}; }
}

function readWlan(nativePath,{interfaceName,includePassword}) {
 const args=['wlan-current',includePassword?'credentials':'metadata'];
 if(interfaceName) args.push(interfaceName);
 return new Promise(resolve=>execFile(nativePath,args,{windowsHide:true,timeout:10000,encoding:'utf8'},
  (error,output)=>resolve(error?{ok:false}:parseWlanConnection(output,includePassword))));
}

function createCurrentNetworkReader({nativePath,wlan=options=>readWlan(nativePath,options),hotspot=readHotspotConfiguration,networks=listNetworks}={}){
 return async function readCurrentNetwork(mode,{interfaceName,snapshot,includePassword=true}={}){
  if(!['hotspot','lan'].includes(mode))return {ok:false,mode,error:'无线模式无效',passwordRead:false};
  if(mode==='hotspot'){
   let current;try{current=await hotspot()}catch{}
   if(!current?.ok)return {ok:false,mode,error:'无法读取Windows移动热点配置，请在系统设置中核对热点名称和密码',passwordRead:false,...(current?.code!==undefined?{code:current.code}:{})};
   const result={ok:true,mode,ssid:current.ssid,channel:0,channelKnown:false,hotspotState:current.state,passwordRead:includePassword&&typeof current.password==='string'&&!!current.password};
   if(result.passwordRead)result.password=current.password;
   const warnings=['Windows未提供移动热点的实际信道，已使用0自动发现'];
   if(includePassword&&!result.passwordRead)warnings.push('热点名称已读取，但无法读取热点密码，请手动填写');
   if(current.state==='Off')warnings.push('热点尚未开启，已读取Windows保存的热点配置');
   else if(current.state==='InTransition')warnings.push('Windows移动热点正在启动，请等待共享接口就绪');
   let state=snapshot;try{if(!state)state=await networks()}catch{}
   const selected=state&&resolveNetworkSelection('hotspot',interfaceName,state);
   if(selected?.ok)result.interfaceName=selected.name;
   else warnings.push('当前热点共享网卡尚未就绪，热点配置已读取');
   result.warning=warnings.join('；');
   return result;
  }
  let current;try{current=await wlan({interfaceName,includePassword})}catch{}
  if(!current?.ok)return {ok:false,mode,error:'读取当前网络失败，请确认已连接Wi-Fi并允许系统读取网络信息',passwordRead:false,...(typeof current?.code==='number'?{code:current.code}:{})};
  const result={ok:true,mode,ssid:current.ssid,passwordRead:false},warnings=[];
  if(current.interfaceName)result.interfaceName=current.interfaceName;
  if(Number.isInteger(current.channel)&&current.channel>=1&&current.channel<=196)result.channel=current.channel;
  else warnings.push('无法读取当前Wi-Fi信道，已保留现有信道设置');
  if(typeof current.bssid==='string'&&/^[\da-f]{2}(:[\da-f]{2}){5}$/i.test(current.bssid)&&current.bssid!=='00:00:00:00:00:00')result.bssid=current.bssid.toUpperCase();
  if(includePassword){
   if(typeof current.password==='string'&&current.password){result.password=current.password;result.passwordRead=true}
   else warnings.push('当前网络已读取，但无法读取已保存密码，请确认共享密码后手动填写');
  }
  if(warnings.length)result.warning=warnings.join('；');
  return result;
 };
}
module.exports={parseWlanConnection,createCurrentNetworkReader};
