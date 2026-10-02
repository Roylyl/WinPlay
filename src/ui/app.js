'use strict';
const $=id=>document.getElementById(id);
let config,running=false,toastTimer,artUrl='',playing={},locale='zh-CN',updateState={},displayItems=[],resolutionChoice,networkRequest=0,networkReadRequest=0,networkReadBusy=false,mediaFormat,displayError='',displayDraft,lastReceiverStatus='';
const logs=[],pendingSaves=new Set();
const t=source=>WinPlayI18n.translate(source,config?.language||'system',locale);
function formatText(source,values={}){return t(source).replace(/\{(\w+)\}/g,(_,key)=>String(values[key]??''))}
function resultDetail(source){return source.split('；').map(t).join(WinPlayI18n.resolveLanguage(config?.language||'system',locale)==='en'?'; ':'；')}
function text(id,source,values){const node=$(id);node.dataset.i18n=source;node._translationValues=values;node._resultDetail=undefined;node.textContent=formatText(source,values)}
function literal(id,value){const node=$(id);delete node.dataset.i18n;node._translationValues=undefined;node.textContent=value}
function applyLanguage(){
  document.documentElement.lang=WinPlayI18n.resolveLanguage(config?.language||'system',locale);
  document.querySelectorAll('[data-i18n]').forEach(node=>{node.textContent=formatText(node.dataset.i18n,node._translationValues)+(node._resultDetail?'\n'+resultDetail(node._resultDetail):'')});
  for(const [name,attribute] of [['title','title'],['aria','aria-label'],['placeholder','placeholder'],['alt','alt']])document.querySelectorAll('[data-i18n-'+name+']').forEach(node=>node.setAttribute(attribute,t(node.dataset['i18n'+name[0].toUpperCase()+name.slice(1)])));
  document.querySelectorAll('option[data-device-label]').forEach(option=>{option.textContent=option.dataset.deviceLabel+(option.dataset.annotation?' · '+t(option.dataset.annotation):'')});
  updateDisplaySummary();renderUpdates();renderLogs();renderMediaFormat();
}
function toast(source){text('toast',source);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500)}
async function call(op,arg){const result=await winplay.call(op,arg);if(!result.ok)toast(result.error);return result}
function theme(dark){document.body.classList.toggle('dark',dark)}
function fieldKey(key){return config.wirelessMode==='lan'?({ssid:'lanSsid',password:'lanPassword',channel:'lanChannel',networkInterface:'lanNetworkInterface'}[key]||key):key}
function wirelessFields(){
  const lan=config.wirelessMode==='lan';$('wirelessMode').value=config.wirelessMode||'hotspot';
  text('wireless-help',lan?'Windows与iPhone加入同一Wi-Fi，并完成蓝牙配对。访客网络、客户端隔离和企业认证可能阻止连接。':'在Windows设置中开启移动热点，填写相同的名称、密码和信道，并完成iPhone蓝牙配对。');
  text('hotspot-settings',lan?'打开定位设置':'打开移动热点');$('lan-bssid').hidden=!lan;
  text('ssid-label',lan?'局域网Wi-Fi名称（SSID）':'本机热点名称');text('password-label',lan?'局域网Wi-Fi共享密码':'本机热点密码');
  $('ssid').dataset.i18nPlaceholder=lan?'两端共用的Wi-Fi名称':'Windows移动热点名称';$('ssid').placeholder=t($('ssid').dataset.i18nPlaceholder);
  $('read-network').disabled=networkReadBusy;
  text('network-help',lan?'自动检测连接现有Wi-Fi的网卡；两端须可互访。':'自动检测Windows移动热点的共享接口；信道0表示自动。');$('channel').min=lan?'1':'0';
  for(const key of ['ssid','password','channel'])$(key).value=config[fieldKey(key)];$('lanAccessPointMac').value=config.lanAccessPointMac||'';
}
function state(active){running=active;$('running-actions').hidden=!active;$('show-video').disabled=true;text('start',active?'应用并重新连接':'启动接收');if(!active)$('fps-fallback').hidden=true;text('side-status',active?'接收中':'未连接');$('side-dot').classList.toggle('connected',active)}
function selected(select,items,value,empty){
  select.replaceChildren();if(empty){const option=document.createElement('option');option.value='';option.dataset.i18n=empty;option.textContent=t(empty);select.append(option)}
  for(const item of items){const option=document.createElement('option');option.value=String(item.value);if(item.translate){option.dataset.i18n=item.label;option.textContent=t(item.label)}else{option.dataset.deviceLabel=item.label;option.dataset.annotation=item.annotation||'';option.textContent=item.label+(item.annotation?' · '+t(item.annotation):'')}select.append(option)}
  if(!items.some(i=>String(i.value)===String(value))&&value!==''&&value!==0){const option=document.createElement('option');option.value=String(value);option.dataset.i18n='已保存设备（暂未检测到）';option.textContent=t(option.dataset.i18n);select.append(option)}select.value=String(value);
}
async function networks(){
  const request=++networkRequest,mode=config.wirelessMode,key=fieldKey('networkInterface'),r=await call('networks');
  if(!r.ok||request!==networkRequest||mode!==config.wirelessMode)return;
  const saved=config[key],valid=r.items.find(n=>n.name===saved&&(mode==='hotspot'?n.activeHotspot:n.lan));
  if(saved&&!valid)await save(key,'');
  selected($('networkInterface'),r.items.map(n=>({value:n.name,label:n.name+(n.ipv6?' · IPv6':''),annotation:n.hotspot?'移动热点':n.lan?'局域网':''})),config[key],'自动检测');
}
async function bluetooth(){const r=await call('bluetooth');if(r.ok)selected($('targetBluetooth'),r.devices.map(d=>({value:d.address,label:d.name+'（'+d.address.replace(/:/g,'').slice(-5)+'）'})),config.targetBluetooth,'自动（上次连接的iPhone）')}
function currentDisplay(){const id=displayError?Number($('displayId').value):config?.displayId;return displayItems.find(d=>d.id===id)||displayItems.find(d=>d.primary)}
function updateDisplaySummary(){const item=currentDisplay();if(!item)return;literal('display-limit',t(item.internal?'内建显示器':'外接显示器')+' · '+item.width+'×'+item.height+t('物理像素')+(item.refreshRate?' · '+item.refreshRate+'Hz':'')+(item.widthMm&&item.heightMm?' · '+item.widthMm+'×'+item.heightMm+'mm':''))}
function displayLimits(){
  const item=currentDisplay();if(!item)return;$('width').max=item.width;$('height').max=item.height;updateDisplaySummary();if(displayError)return;$('displayId').value=String(item.id);$('width').disabled=config.fullScreen;$('height').disabled=config.fullScreen;$('fullScreen').checked=!!config.fullScreen;
  $('width').value=config.fullScreen?item.width:config.width;$('height').value=config.fullScreen?item.height:config.height;updateDisplaySummary();
  const size=config.width+'x'+config.height;for(const option of $('resolutionPreset').options){if(/^\d+x\d+$/.test(option.value)){const [w,h]=option.value.split('x').map(Number);option.disabled=w>item.width||h>item.height}}
  const preset=[...$('resolutionPreset').options].some(o=>o.value===size&&!o.disabled);$('resolutionPreset').value=config.fullScreen?'native':resolutionChoice==='custom'?'custom':preset?size:'custom';$('custom-size').hidden=$('resolutionPreset').value!=='custom';$('request-pixels').textContent=$('width').value+'×'+$('height').value;
}
async function saveDisplay(values){values={...displayDraft,...values,resolutionMode:resolutionChoice||'preset'};displayDraft=values;const request=call('save',values);pendingSaves.add(request);let r;try{r=await request}finally{pendingSaves.delete(request)}if(r.ok){Object.assign(config,values);displayDraft=undefined;displayError='';result('display-error','');displayLimits()}else{displayError=r.error||'请填写不超过所选屏幕物理分辨率的偶数像素尺寸';result('display-error',displayError)}return r}
async function displays(){const r=await call('displays');if(r.ok){const draftId=displayError?Number($('displayId').value):null;displayItems=r.items;if(!displayError&&!r.items.some(d=>d.id===config.displayId))config.displayId=r.items.find(d=>d.internal)?.id||r.items.find(d=>d.primary)?.id||r.items[0]?.id;selected($('displayId'),r.items.map(d=>({value:d.id,label:d.label+' · '+d.width+'×'+d.height,annotation:d.primary?'主显示器':''})),draftId??config.displayId);displayLimits()}}
async function audioDevices(request=false){
  try{if(request){const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(track=>track.stop())}const list=await navigator.mediaDevices.enumerateDevices();
    selected($('outputDevice'),list.filter(d=>d.kind==='audiooutput'&&d.deviceId!=='default'&&d.deviceId!=='communications').map((d,i)=>({value:d.deviceId,label:d.label||'输出设备'+(i+1),translate:!d.label})),config.outputDevice,'系统默认设备');
    selected($('inputDevice'),list.filter(d=>d.kind==='audioinput'&&d.deviceId!=='default'&&d.deviceId!=='communications').map((d,i)=>({value:d.deviceId,label:d.label||'输入设备'+(i+1),translate:!d.label})),config.inputDevice,'系统默认设备');
  }catch{toast('Windows未允许麦克风访问，请检查系统隐私设置')}
}
async function save(key,value){const request=call('save',{[key]:value});pendingSaves.add(request);let r;try{r=await request}finally{pendingSaves.delete(request)}if(!r.ok)return r;config[key]=value;if(key==='theme')theme(value==='dark'||value==='system'&&(await winplay.call('state')).dark);if(key==='language')applyLanguage();return r}
function showPage(page){document.querySelectorAll('.nav').forEach(button=>button.classList.toggle('active',button.dataset.page===page));document.querySelectorAll('.page').forEach(node=>node.hidden=node.id!==page);$('receiver-footer').hidden=page==='about'}
document.querySelectorAll('.nav').forEach(button=>button.addEventListener('click',()=>showPage(button.dataset.page)));
function format(ms){const seconds=Math.max(0,Math.floor((ms||0)/1000));return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')}
function metadata(s,artChanged){
  playing=s;if(artChanged){if(artUrl)URL.revokeObjectURL(artUrl);artUrl=s.artwork?.length?URL.createObjectURL(new Blob([new Uint8Array(s.artwork)],{type:s.artwork[0]===137?'image/png':'image/jpeg'})):'';$('artwork').hidden=!artUrl;if(artUrl)$('artwork').src=artUrl;else $('artwork').removeAttribute('src')}
  if(s.title)literal('track-title',s.title);else text('track-title','未上报歌名');literal('track-artist',[s.artist,s.album].filter(Boolean).join(' · '));$('seek').max=s.durationMs||1;$('seek').disabled=!s.canSeek||!s.durationMs;position(s.positionMs);
  if('mediaSession' in navigator){if(!navigator.mediaSession.metadata)navigator.mediaSession.metadata=new MediaMetadata();const meta=navigator.mediaSession.metadata;meta.title=s.title;meta.artist=s.artist;meta.album=s.album;if(artChanged)meta.artwork=artUrl?[{src:artUrl,type:s.artwork?.[0]===137?'image/png':'image/jpeg'}]:[];navigator.mediaSession.playbackState=s.playing?'playing':'paused';for(const [name,index] of [['play',1],['pause',2],['previoustrack',5],['nexttrack',4]])navigator.mediaSession.setActionHandler(name,()=>winplay.input({command:'media',index}));try{navigator.mediaSession.setActionHandler('seekto',s.canSeek&&s.durationMs?event=>winplay.input({command:'seek',ms:Math.round(event.seekTime*1000)}):null)}catch{}}
}
function position(ms){$('seek').value=Math.min(playing.durationMs||1,ms||0);$('progress').textContent=format(ms)+' / '+format(playing.durationMs);if(navigator.mediaSession&&playing.durationMs>0){try{navigator.mediaSession.setPositionState({duration:playing.durationMs/1000,position:Math.min(playing.durationMs/1000,Math.max(0,(ms||0)/1000)),playbackRate:1})}catch{}}}
function renderLogs(){if(logs.length)literal('logs',logs.slice(-100).join('\n'));else text('logs','暂无日志');$('open-log').disabled=!logs.length}
function diagnosticLine(item){return new Date(item.time||Date.now()).toLocaleTimeString()+'  '+item.status+(item.detail?'\n'+item.detail:'')}
function renderUpdates(){
  const value=updateState||{};$('automatic-updates').checked=value.automatic!==false;$('check-updates').disabled=!!value.checking;text('check-updates',value.checking?'正在检查更新…':'检查更新');
  text('update-status',value.status||'尚未检查更新');
  const detail=value.detail||'',missing=value.release&&!value.release.installer;
  $('update-detail').hidden=!detail&&!missing;if(detail||missing)literal('update-detail',t(detail)+(detail&&missing?' · ':'')+(missing?t('没有适合当前架构的安装包'):''));
  $('download-update').hidden=!(value.release?.installer);$('download-update').disabled=!!value.checking;
}
function renderMediaFormat(){if(!mediaFormat)return;const o=mediaFormat;literal('actual-media-format',(o.codec==='pcm'?'PCM/16-bit':o.codec==='aac-lc'?'AAC-LC':o.codec.toUpperCase())+' · '+o.clockRate/1000+'kHz · '+formatText('{channels}声道',{channels:o.channels}))}
function result(id,source,detail=''){text(id,source);const node=$(id);node._resultDetail=detail;if(detail)node.textContent+='\n'+resultDetail(detail);node.hidden=!source&&!detail}
winplay.on(message=>{
  if(message.type==='language'){locale=message.locale||locale;if(config){config.language=message.language||'system';$('language').value=config.language;applyLanguage()}}
  if(message.type==='updates'){updateState=message.updates||{};renderUpdates()}
  if(message.type==='close-behavior'){if(config)config.closeBehavior=message.value;$('closeBehavior').value=message.value}
  if(message.type==='appearance')theme(message.dark);
  if(message.type==='starting'||message.type==='started'){lastReceiverStatus='';state(true);if(config)window.winplayAudio?.prepare(config).catch(()=>{})}
  if(message.type==='requested-fps'){$('fps-fallback').hidden=message.attempt>=message.requested;text('fps-fallback','当前已从{requested}fps回退至{attempt}fps',{requested:message.requested,attempt:message.attempt})}
  if(message.type==='status'||message.type==='diagnostic'){if(message.type==='status'){lastReceiverStatus=message.status+' '+(message.detail||'');text('status',message.status);text('status-detail',message.detail||'')}logs.push(diagnosticLine(message));renderLogs()}
  if(message.type==='connected')text('side-status','已收到视频');
  if(message.type==='stopped'){
    const failure=/失败|拒绝|未建立|超时|无法|没有检测|请选择|异常/.test(lastReceiverStatus);state(false);metadata({title:'',artist:'',album:'',playing:false,canSeek:false,durationMs:0,positionMs:0},true);
    if(navigator.mediaSession){navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none';for(const action of ['play','pause','previoustrack','nexttrack','seekto']){try{navigator.mediaSession.setActionHandler(action,null)}catch{}}}
    if(!failure){text('status','接收已停止');text('status-detail','可以重新启动接收。')}mediaFormat=undefined;text('actual-media-format','等待iPhone协商');
  }
  if(message.type==='metrics'){$('show-video').disabled=!(running&&message.decodedWidth);$('metric-request').textContent=message.requested+'fps';$('metric-attempt').textContent=running?message.attempt+'fps':'—';$('metric-received').textContent=running?message.receivedFps.toFixed(1)+'fps':'—';$('metric-decoded').textContent=running?(message.decodedFps||0).toFixed(1)+'fps':'—';if(message.decodedWidth)text('video-size','实际解码尺寸：{width}×{height}',{width:message.decodedWidth,height:message.decodedHeight})}
  if(message.type==='audio-config'&&message.opts.media){mediaFormat=message.opts;renderMediaFormat()}
  if(message.type==='now-playing')metadata(message.state,message.artChanged);if(message.type==='position')position(message.positionMs);window.winplayAudio?.handle(message);
});
(async()=>{
  const r=await call('state');if(!r.ok)return;config=r.settings;config.language=config.language||'system';locale=r.locale||navigator.language;resolutionChoice=config.resolutionMode;updateState=r.updates||{};theme(r.dark);state(r.running);$('show-video').disabled=!(r.running&&r.stats?.decodedWidth);$('version').textContent=$('about-version').textContent=r.version;literal('architecture',r.architecture||'x64');
  for(const item of r.diagnostics||[])logs.push(diagnosticLine(item));renderLogs();text('auth-status',r.auth?'文件已就绪，等待iPhone验证':'缺少文件');
  for(const key of ['ssid','password','channel','fps','theme','closeBehavior','language']){$(key).value=config[fieldKey(key)];$(key).addEventListener('change',()=>save(fieldKey(key),['channel','fps'].includes(key)?Number($(key).value):$(key).value))}
  for(const key of ['targetBluetooth','networkInterface','inputDevice','outputDevice'])$(key).addEventListener('change',()=>save(fieldKey(key),$(key).value));
  for(const key of ['mediaVolume','callVolume']){$(key).value=Math.round(config[key]*100);$(key==='mediaVolume'?'media-label':'call-label').textContent=$(key).value+'%';$(key).addEventListener('input',()=>{$(key==='mediaVolume'?'media-label':'call-label').textContent=$(key).value+'%';save(key,Number($(key).value)/100)})}
  $('lanAccessPointMac').addEventListener('change',()=>save('lanAccessPointMac',$('lanAccessPointMac').value.trim()));$('wirelessMode').addEventListener('change',async()=>{const mode=$('wirelessMode').value;++networkReadRequest;const saved=await save('wirelessMode',mode);if(!saved.ok){if($('wirelessMode').value===mode)$('wirelessMode').value=config.wirelessMode;return}if($('wirelessMode').value!==mode)return;result('network-result','');wirelessFields();await networks()});wirelessFields();
  $('resolutionPreset').onchange=async()=>{const value=$('resolutionPreset').value;resolutionChoice=value;$('custom-size').hidden=value!=='custom';if(value==='native')await saveDisplay({fullScreen:true});else if(value==='custom')await saveDisplay({fullScreen:false,width:Number($('width').value),height:Number($('height').value)});else{const [width,height]=value.split('x').map(Number);await saveDisplay({fullScreen:false,width,height})}};
  $('width').oninput=$('height').oninput=()=>{$('request-pixels').textContent=($('width').value||'—')+'×'+($('height').value||'—')};
  $('width').onchange=$('height').onchange=()=>saveDisplay({width:Number($('width').value),height:Number($('height').value)});$('fullScreen').onchange=()=>saveDisplay({fullScreen:$('fullScreen').checked});$('displayId').onchange=()=>{const item=displayItems.find(d=>d.id===Number($('displayId').value));if(item)saveDisplay({displayId:item.id})};
  $('start').onclick=async()=>{const active=running;$('start').disabled=true;try{const saved=await Promise.all([...pendingSaves]);if(displayError){showPage('display');result('display-error',displayError);return}if(saved.some(value=>!value.ok))return;await window.winplayAudio.prepare(config);await call(active?'restart':'start')}finally{$('start').disabled=false}};$('stop').onclick=()=>call('stop');$('show-video').onclick=()=>call('show-video');
  $('audioEnabled').checked=config.audioEnabled!==false;$('audioEnabled').onchange=()=>save('audioEnabled',$('audioEnabled').checked);$('open-auth').onclick=()=>call('open-auth');$('open-log').onclick=()=>call('open-log');
  $('refresh-status').onclick=async()=>{const value=await call('state');if(value.ok){text('auth-status',value.auth?'文件已就绪，等待iPhone验证':'缺少文件');logs.length=0;for(const item of value.diagnostics||[])logs.push(diagnosticLine(item));renderLogs();updateState=value.updates||updateState;renderUpdates()}};
  $('hotspot-settings').onclick=()=>call(config.wirelessMode==='lan'?'settings-location':'settings-hotspot');$('bluetooth-settings').onclick=()=>call('settings-bluetooth');$('refresh-bt').onclick=bluetooth;$('refresh-network').onclick=networks;$('refresh-displays').onclick=displays;$('refresh-audio').onclick=()=>audioDevices(true);
  $('import-auth').onclick=async()=>{const value=await winplay.call('import-auth');if(value.ok){text('auth-status','认证文件已更新');result('auth-result','认证材料已用Windows DPAPI保护保存')}else result('auth-result',value.error)};
  $('export-diagnostics').onclick=async()=>{const value=await winplay.call('export-diagnostics');result('log-result',value.ok?'日志已导出':value.error)};
  $('project-home').onclick=()=>call('open-project');$('release-notes').onclick=()=>call('open-release');$('download-update').onclick=()=>call('download-update');
  $('check-updates').onclick=async()=>{$('check-updates').disabled=true;text('check-updates','正在检查更新…');try{const value=await winplay.call('check-updates');if(value.updates)updateState=value.updates;else if(!value.ok)updateState={...updateState,checking:false,status:'检查更新失败',detail:value.error}}finally{renderUpdates()}};
  $('automatic-updates').onchange=async()=>{const button=$('automatic-updates');button.disabled=true;try{const value=await call('set-automatic-updates',{enabled:button.checked});if(value.updates)updateState=value.updates;else if(value.ok)updateState.automatic=button.checked;renderUpdates()}finally{button.disabled=false}};
  $('previous').onclick=()=>winplay.input({command:'media',index:5});$('playpause').onclick=()=>winplay.input({command:'media',index:3});$('next').onclick=()=>winplay.input({command:'media',index:4});$('seek').addEventListener('change',()=>winplay.input({command:'seek',ms:Math.round(Number($('seek').value))}));
  $('read-network').onclick=async()=>{
    if(networkReadBusy)return;const button=$('read-network'),mode=$('wirelessMode').value||config.wirelessMode,request=++networkReadRequest,before=[...pendingSaves];
    const current=()=>request===networkReadRequest&&mode===config.wirelessMode&&mode===($('wirelessMode').value||config.wirelessMode);
    networkReadBusy=true;button.disabled=true;text('read-network','正在读取网络和密码…');result('network-result','');
    const operation=(async()=>{
      const previous=await Promise.all(before);if(!current())return {ok:true,ignored:true};if(previous.some(value=>!value.ok))return {ok:false};
      const value=await winplay.call('read-current-network',{mode});if(!current())return {ok:true,ignored:true};
      if(!value.ok){result('network-result',value.error||'未能读取当前网络，请检查网络设置后重试。');return value}
      if(value.mode&&value.mode!==mode)return {ok:true,ignored:true};
      if(typeof value.ssid!=='string'||!value.ssid){result('network-result','未能读取当前网络，请检查网络设置后重试。');return {ok:false}}
      const lan=mode==='lan',keys=lan?{ssid:'lanSsid',password:'lanPassword',channel:'lanChannel',networkInterface:'lanNetworkInterface'}:{ssid:'ssid',password:'password',channel:'channel',networkInterface:'networkInterface'},values={[keys.ssid]:value.ssid};
      if(lan)values.lanAccessPointMac=value.bssid||'';
      if(value.interfaceName)values[keys.networkInterface]=value.interfaceName;
      if(Number.isInteger(value.channel)&&value.channel>=(lan?1:0)&&value.channel<=196)values[keys.channel]=value.channel;
      const passwordRead=typeof value.password==='string'&&value.password.length>0;if(passwordRead)values[keys.password]=value.password;
      const saved=await call('save',values);if(!saved.ok){if(current())result('network-result',saved.error||'网络设置保存失败，请重试。');return saved}
      Object.assign(config,values);if(!current())return {ok:true,ignored:true};
      wirelessFields();await networks();if(current())result('network-result',passwordRead?'已读取当前网络和密码。':'已读取当前网络，未能读取密码；已保留原密码。',value.warning||'');
      return saved;
    })().catch(error=>{if(current())result('network-result',error.message||'未能读取当前网络，请检查网络设置后重试。');return {ok:false}});pendingSaves.add(operation);
    try{return await operation}finally{pendingSaves.delete(operation);networkReadBusy=false;text('read-network','读取当前网络和密码');button.disabled=false}
  };
  $('collapse-sidebar').onclick=()=>document.body.classList.toggle('sidebar-collapsed');const resizer=$('sidebar-resizer');resizer.onpointerdown=e=>{resizer.setPointerCapture(e.pointerId);resizer.onpointermove=event=>{document.querySelector('aside').style.width=Math.max(150,Math.min(200,event.clientX))+'px'};resizer.onpointerup=()=>{resizer.onpointermove=null}};
  document.addEventListener('keydown',event=>{if(event.key!=='Enter'||event.defaultPrevented||event.ctrlKey||event.altKey||event.metaKey||$('receiver-footer').hidden||$('start').disabled)return;if(event.target.closest('button,select,summary')||event.target.matches('input[type=range],input[type=checkbox]'))return;event.preventDefault();event.target.blur?.();$('start').click()});
  let refreshing=false;window.addEventListener('focus',async()=>{if(refreshing)return;refreshing=true;try{await Promise.all([networks(),displays(),audioDevices(),bluetooth()])}finally{refreshing=false}});applyLanguage();await Promise.all([networks(),displays(),audioDevices(),bluetooth()]);navigator.mediaDevices.addEventListener('devicechange',()=>audioDevices());
})().catch(()=>toast('界面初始化失败，请重新打开WinPlay'));
