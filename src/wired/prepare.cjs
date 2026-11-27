'use strict';

const { nativePath } = require('./native-path.cjs');
const { spawnSync, execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');
const { setTimeout: wait } = require('node:timers/promises');
const { inspectParent } = require('./inspect.cjs');
const { selectUsbIphone, parentPattern } = require('./iphone-target.cjs');

function invokeModeReader(parent, mux, configurationCount, requestMode) {
  const exe = nativePath('AppleUsbMode.exe');
  const args = ['--parent-instance', parent, String(mux), String(configurationCount),
    requestMode ? '--request-mode4' : '--descriptor'];
  const result = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 13000, maxBuffer: 4096 });
  if (result.error?.code === 'ENOENT') throw new Error('WinPlay Apple USB mode helper is missing.');
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'Apple USB command did not complete; inspect current configuration before retrying.');
  }
  return JSON.parse(result.stdout);
}

function prepareUsbParent(parent, requestMode = false, inspect = inspectParent, invoke = invokeModeReader) {
  if (typeof parent !== 'string' || !parentPattern.test(parent)) {
    throw new Error('Specify one complete Apple USB parent instance.');
  }
  if (typeof requestMode !== 'boolean') throw new TypeError('Expected a boolean requestMode.');
  const snapshot = inspect(parent);
  const count = snapshot.configurations.length;
  if (requestMode && snapshot.configurations.some(entry => entry.mediaEndpoints)) {
    return { action: 'media-configuration-already-exposed', activeValue: snapshot.activeValue, configurationCount: count };
  }
  if (!Number.isInteger(snapshot.activeUsbMuxInterface)) throw new Error('The active configuration has no unique USBMUX interface.');
  return invoke(parent, snapshot.activeUsbMuxInterface, count, requestMode);
}

async function prepareWiredIphone(parent, requestMode = false, select = selectUsbIphone, prepare = prepareUsbParent) {
  const target = parent === undefined ? (await select()).parentInstance : parent;
  return prepare(target, requestMode);
}

async function findAdapter(parentInstance, controlInterface, signal) {
  if(!parentPattern.test(parentInstance)||!Number.isInteger(controlInterface)||controlInterface<0||controlInterface>255)return null;
  const run = promisify(execFile);
  const {stdout} = await run(nativePath('WinPlay.UsbTopology.exe'), [
    '--ncm',parentInstance,String(controlInterface)
  ], {windowsHide:true, timeout:2500, signal});
  return JSON.parse(stdout);
}

async function prepareWindowsNcm(parent, report) {
  const ordinary = report.configurations.find(config =>
    config.usbMuxInterface !== undefined && !config.ncmControl && !config.appleEthernet);
  const preferred = report.selected;
  if(!ordinary || !preferred)throw Object.assign(Error('No verified CarPlay configuration'),{code:'USB_NCM_NOT_READY'});
  const request=Buffer.from(JSON.stringify({
    parent,ordinaryIndex:ordinary.configurationIndex,ordinaryValue:ordinary.value,ordinaryMux:ordinary.usbMuxInterface,
    preferredIndex:preferred.configurationIndex,preferredValue:preferred.value
  })).toString('base64');
  const unpacked=__dirname.replace(/([\\/])app\.asar(?=[\\/])/i,'$1app.asar.unpacked');
  const script=path.join(unpacked,'prepare-ncm.ps1').replaceAll("'","''");
  const command=`$argsList=@('-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',([char]34+'${script}'+[char]34),'-Request','${request}'); try{$p=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -ArgumentList $argsList -Verb RunAs -WindowStyle Hidden -Wait -PassThru;exit $p.ExitCode}catch{exit 2}`;
  try{
    await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{
      windowsHide:true,timeout:65000
    });
  }catch(error){
    throw Object.assign(Error('Windows NCM preparation did not complete'),{
      code:error.code===2?'USB_NCM_APPROVAL_REQUIRED':'USB_NCM_NOT_READY'
    });
  }
}

async function prepareWiredConnection({signal,target:confirmedTarget,targetKey,lastKey,log=()=>{}} = {}) {
  const started=Date.now();
  const stage=(name)=>log(name,{elapsedMs:Date.now()-started});
  let target = confirmedTarget || await selectUsbIphone({targetKey,lastKey});
  stage('已确认USB设备');
  signal?.throwIfAborted();
  const parent = target.parentInstance;
  const run = promisify(execFile);
  const read = async () => {
    const {stdout} = await run(nativePath('UsbReadConfigurations.exe'), ['--parent-instance',parent], {
      windowsHide:true, timeout:4000, maxBuffer:32*1024*1024, signal
    });
    return require('./inspect.cjs').analyzeSnapshot(JSON.parse(stdout), {transitionAttempted:true});
  };
  let report = await read();
  stage('已读取USB配置');
  const requiresModeSwitch = !report.configurations.some(config=>config.mediaEndpoints);
  if(requiresModeSwitch){
    stage('请求切换CarPlay模式');
    if(!Number.isInteger(report.activeUsbMuxInterface)) throw Object.assign(Error('USBMUX unavailable'),{code:'USB_MODE_FAILED'});
    try {
      await run(nativePath('AppleUsbMode.exe'), ['--parent-instance',parent,String(report.activeUsbMuxInterface),String(report.configurations.length),'--request-mode4'], {
        windowsHide:true, timeout:13000, signal
      });
    } catch(error) {
      const reason=String(error.stderr||'');
      if(!reason.includes('mode4-no-confirmed-response')) throw Object.assign(Error('Apple USB mode request failed'),{code:'USB_MODE_FAILED'});
    }
  }
  let repaired=false;
  let deadline = Date.now() + 5000;
  let repairReport=report.selected ? report : undefined;
  if(requiresModeSwitch)report=undefined;
  while(true){
    signal?.throwIfAborted();
    try {
      report ||= await read();
      if(report.selected)repairReport=report;
      if (report.activeCandidate) {
        const {controlInterface,usbMuxInterface}=report.activeCandidate;
        const adapter=await findAdapter(parent,controlInterface,signal);
        if (adapter) {
          if (requiresModeSwitch||repaired) target=await selectUsbIphone({targetKey:target.key});
          if (target.parentInstance.toUpperCase() !== parent.toUpperCase()) throw Error('USB target changed');
          stage('USB网卡已就绪');
          return {...adapter,parentInstance:parent,controlInterface,usbMuxInterface,deviceId:target.DeviceID,key:target.key};
        }
      }
    }catch(error){if(signal?.aborted)throw error}
    if(Date.now()>=deadline){
      if(repaired||!repairReport)break;
      stage('Windows正在准备USB网卡');
      await prepareWindowsNcm(parent,repairReport);
      signal?.throwIfAborted();
      repaired=true;
      deadline=Date.now()+10000;
    }
    report=undefined;
    await wait(250,undefined,{signal});
  }
  throw Object.assign(Error('Windows did not bind the CarPlay NCM adapter'),{code:'USB_NCM_NOT_READY'});
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const usage = 'Usage: node prepare.cjs [--parent-instance <Apple USB parent instance>] [--request-mode4]';
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
  } else {
    const requestMode = args[args.length - 1] === '--request-mode4';
    if (requestMode) args.pop();
    if (args.length && (args.length !== 2 || args[0] !== '--parent-instance' || !parentPattern.test(args[1]))) {
      console.error(usage); process.exitCode = 2;
    } else {
      prepareWiredIphone(args[1], requestMode).then(
        result => console.log(JSON.stringify(result)), error => { console.error(error.message); process.exitCode = 1; });
    }
  }
}

module.exports = { prepareUsbParent, prepareWiredIphone, selectUsbIphone, prepareWiredConnection, prepareWindowsNcm, findAdapter };
