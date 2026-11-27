'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { createInterface } = require('node:readline');
const { Duplex } = require('node:stream');
const { nativePath } = require('./native-path.cjs');

// Windows can read Store package files, but an unpackaged process cannot map
// their DLLs directly. Use only the installed Apple runtime and its dependencies.
const appleRuntimeFiles = [
  'ASL.dll','CFNetwork.dll','CoreFoundation.dll','icudt62.dll','libdispatch.dll',
  'libicuin.dll','libicuuc.dll','libxml2.dll','MobileDevice.dll','msvcp140.dll',
  'objc.dll','pthreadVC2.dll','SQLite3.dll','vcruntime140_1.dll','vcruntime140.dll','zlib1.dll'
];

function localAppleRuntime(source) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'WinPlay-Apple-'));
  const clean=()=>{
    for(const name of appleRuntimeFiles){
      try{fs.unlinkSync(path.join(directory,name));}catch{}
    }
    try{fs.rmdirSync(directory);}catch{}
  };
  try{
    for(const name of appleRuntimeFiles){
      const file=path.join(source,name);
      if(fs.existsSync(file))fs.copyFileSync(file,path.join(directory,name),fs.constants.COPYFILE_EXCL);
    }
    return {directory,clean};
  }catch(error){clean();throw error;}
}

async function openAppleService(deviceId, signal) {
  const common = path.join(process.env.CommonProgramFiles || 'C:\\Program Files\\Common Files','Apple','Mobile Device Support');
  const usable = dir => path.isAbsolute(dir) &&
    ['MobileDevice.dll','CoreFoundation.dll'].every(name=>fs.existsSync(path.join(dir,name)));
  let directory=usable(common)?common:undefined;
  if(!directory){
    const installed=await promisify(execFile)(nativePath('WinPlay.UsbTopology.exe'),['--apple-runtime'],{
      windowsHide:true,timeout:2500,signal
    }).then(result=>JSON.parse(result.stdout)).catch(()=>[]);
    const prefix=path.join(process.env.ProgramFiles || 'C:\\Program Files','WindowsApps','AppleInc.AppleDevices_').toLowerCase();
    directory=installed.find(dir=>dir.toLowerCase().startsWith(prefix)&&usable(dir));
  }
  signal.throwIfAborted();
  if (!directory) throw Error('请安装Apple设备应用，并在Windows中确认iPhone可以通过数据线访问。');
  const local=directory===common?{directory,clean:()=>{}}:localAppleRuntime(directory);
  const child = spawn(nativePath('WinPlay.CarKit.exe'), [local.directory,String(deviceId),'--usb-identity-fd3'], {
    windowsHide:true, stdio:['pipe','pipe','pipe','pipe'], signal
  });
  child.once('close', local.clean);
  // The bridge writes the device identity only to the private extra pipe.
  const stream = Duplex.from({readable:child.stdout,writable:child.stdin});
  stream.on('error',()=>{});
  const diagnostics=createInterface({input:child.stderr});
  const identities=createInterface({input:child.stdio[3]});
  let phoneDeviceId, ready=false, failure='';
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();fail(Error('等待iPhone有线服务超时。'));},16000);
    function fail(error){clearTimeout(timer);reject(error);}
    function complete(){if(ready&&phoneDeviceId){clearTimeout(timer);resolve();}}
    child.on('error',()=>fail(Error('无法启动Apple有线服务。')));
    child.once('exit',()=>fail(Error(failure)));
    diagnostics.on('line',line=>{
      if(line==='carkit:service-ready'){ready=true;complete();}
      if(line.startsWith('carkit:failed')){
        failure=/trust-required|validate-pairing|lockdown-session/.test(line)
          ?'请解锁iPhone，并在手机上确认信任这台电脑。'
          :'iPhone没有打开有线CarPlay控制服务。';
      }
    });
    identities.on('line',line=>{if(/^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(line)){phoneDeviceId=line;complete();}});
  }).catch(error=>{child.kill();throw error.message?error:Error('Apple有线服务提前结束。');});
  return {child,stream,phoneDeviceId};
}

module.exports={openAppleService,localAppleRuntime};
