const {execFile}=require('node:child_process');
const {readHotspotConfiguration}=require('./mobile-hotspot-reader.cjs');
const {listNetworks,resolveNetworkSelection}=require('./network-selection.cjs');
function decodeOutput(out){if(typeof out==='string')return out;const utf=new TextDecoder('utf-8').decode(out||new Uint8Array());return utf.includes('\ufffd')?new TextDecoder('gb18030').decode(out):utf}
function parseResult(op,out,error,{interfaceName}={}){const text=decodeOutput(out),pick=(names,block=text)=>block.match(new RegExp('^\\s*(?:'+names+')\\s*:[ \\t]*(.*?)\\r?$','mi'))?.[1]?.trim();const code=error?.code;
 const detail=text.split(/\r?\n/).map(x=>x.trim()).find(x=>/error|denied|not found|错误|失败|找不到|不存在|拒绝|权限/i.test(x)&&!/key content|关键内容|password|passphrase|私钥|证书/i.test(x))||'';
 const failure=(message)=>({ok:false,error:message+(typeof code==='number'?'（系统退出码'+code+'）':code?'（'+String(code)+'）':'')+(detail?'：'+detail.slice(0,250):''),code:code??null});
 if(error)return failure(op==='read-password'?'读取已保存密码失败':'读取当前网络失败');
 if(op==='read-password'){const password=pick('Key Content|关键内容|金鑰內容');return password?{ok:true,password}:failure('该网络没有可读取的已保存共享密码，请手动填写')}
 // Name, SSID, channel and router BSSID must come from the same connection.
 // The first wireless adapter can be disconnected while a later one is live.
 const blocks=text.split(/(?=^[ \t]*(?:Name|名称|名稱)[ \t]*:)/mi);
 const block=blocks.find(item=>!!pick('SSID',item)&&(!interfaceName||String(pick('Name|名称|名稱',item)).toLowerCase()===String(interfaceName).toLowerCase()));
 if(!block)return failure('未检测到已连接的Wi-Fi；移动热点请在Windows设置中查看');
 const ssid=pick('SSID',block),channel=Number(pick('Channel|频道|信道|通道',block)),matchedInterface=pick('Name|名称|名稱',block);
 const profileName=pick('Profile|配置文件|設定檔|设定档',block);
 return {ok:true,ssid,channel,bssid:pick('BSSID',block),...(matchedInterface?{interfaceName:matchedInterface}:{}),...(profileName?{profileName}:{})}
}
async function readWlan(op,ssid,options={}){
 if(!['read-network','read-password'].includes(op))throw Error('无线读取操作无效');
 if(op==='read-password'&&(typeof ssid!=='string'||!ssid.trim()||Buffer.byteLength(ssid)>32||ssid.includes('\0')))throw Error('请先填写有效SSID');
 const args=op==='read-network'?['wlan','show','interfaces']:['wlan','show','profile','name='+(options.profileName||ssid),'key=clear'];
 if(op==='read-password'&&options.interfaceName)args.push('interface='+options.interfaceName);
 return new Promise(resolve=>execFile('netsh.exe',args,{windowsHide:true,timeout:10000,encoding:'buffer'},(error,out)=>resolve(parseResult(op,out,error,options))));
}

function createCurrentNetworkReader({wlan=readWlan,hotspot=readHotspotConfiguration,networks=listNetworks}={}){
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
  let current;try{current=await wlan('read-network',undefined,{interfaceName})}catch{}
  if(!current?.ok)return {ok:false,mode,error:'读取当前网络失败，请确认已连接Wi-Fi并允许系统读取网络信息',passwordRead:false,...(typeof current?.code==='number'?{code:current.code}:{})};
  const result={ok:true,mode,ssid:current.ssid,passwordRead:false},warnings=[];
  if(current.interfaceName)result.interfaceName=current.interfaceName;
  if(Number.isInteger(current.channel)&&current.channel>=1&&current.channel<=196)result.channel=current.channel;
  else warnings.push('无法读取当前Wi-Fi信道，已保留现有信道设置');
  if(typeof current.bssid==='string'&&/^[\da-f]{2}(:[\da-f]{2}){5}$/i.test(current.bssid)&&current.bssid!=='00:00:00:00:00:00')result.bssid=current.bssid.toUpperCase();
  if(includePassword){
   let saved;try{saved=await wlan('read-password',current.ssid,{interfaceName:current.interfaceName,profileName:current.profileName})}catch{}
   if(saved?.ok&&typeof saved.password==='string'&&saved.password){result.password=saved.password;result.passwordRead=true}
   else warnings.push('当前网络已读取，但无法读取已保存密码，请确认共享密码后手动填写');
  }
  if(warnings.length)result.warning=warnings.join('；');
  return result;
 };
}
const readCurrentNetwork=createCurrentNetworkReader();
module.exports={readWlan,parseResult,readCurrentNetwork,createCurrentNetworkReader};
