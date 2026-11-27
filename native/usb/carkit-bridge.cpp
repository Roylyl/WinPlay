#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdio>
#include <cwchar>
#include <cstring>
#include <cstdlib>
#include <thread>
#include <atomic>
#include <string>
#include <vector>
#include <fcntl.h>
#include <io.h>

using Ref=void*;
struct Notice { Ref device; unsigned message; };
using Callback=void(*)(Notice*,Ref);
struct Failure { const char *stage; unsigned code; };
static void check(int rc,const char* stage) { if(rc!=0)throw Failure{stage,(unsigned)rc}; }
template<class F> F load(HMODULE module,const char* name) {
 auto proc=GetProcAddress(module,name);if(!proc) throw Failure{name,GetLastError()};return reinterpret_cast<F>(proc);
}
struct API {
 int (*subscribe)(Callback,unsigned,unsigned,Ref,Ref*);
 unsigned (*deviceID)(Ref);
 int (*interfaceType)(Ref);
 Ref (*retain)(Ref);
 int (*connect)(Ref), (*paired)(Ref), (*validate)(Ref), (*startSession)(Ref), (*stopSession)(Ref), (*disconnect)(Ref);
 int (*startService)(Ref,Ref,Ref,Ref*);
 int (*recv)(Ref,void*,size_t),(*send)(Ref,const void*,size_t);
 Ref (*makeString)(Ref,const char*,unsigned);
 Ref (*copyValue)(Ref,Ref,Ref);
 uintptr_t (*typeID)(Ref), (*stringTypeID)();
 unsigned char (*copyString)(Ref,char*,intptr_t,unsigned);
 void (*release)(Ref);
 int (*runLoop)(Ref,double,unsigned char);
 Ref mode;
};
static API a{};
static unsigned targetID;
static std::atomic<Ref> selected{};
static void onNotice(Notice* note,Ref) {
 if(note && note->message==1 && note->device && a.interfaceType(note->device)==1
    && a.deviceID(note->device)==targetID && !selected.load()) {
    a.retain(note->device);selected.store(note->device);
 }
}
static void marker(const char* msg) { fprintf(stderr,"carkit:%s\n",msg);fflush(stderr); }
static API openAPI(const std::wstring& dir) {
 if(!SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32|LOAD_LIBRARY_SEARCH_USER_DIRS) || !AddDllDirectory(dir.c_str())) throw Failure{"dll-directory",GetLastError()};
 HMODULE cf=LoadLibraryExW((dir+L"\\CoreFoundation.dll").c_str(),nullptr,LOAD_LIBRARY_SEARCH_DEFAULT_DIRS|LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR);
 if(!cf) throw Failure{"load-corefoundation",GetLastError()};
 HMODULE md=LoadLibraryExW((dir+L"\\MobileDevice.dll").c_str(),nullptr,LOAD_LIBRARY_SEARCH_DEFAULT_DIRS|LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR);
 if(!md) throw Failure{"load-mobiledevice",GetLastError()};
 API v{};
#define MD(field,name) v.field=load<decltype(v.field)>(md,name)
 MD(subscribe,"AMDeviceNotificationSubscribe"); MD(deviceID,"AMDeviceGetConnectionID"); MD(interfaceType,"AMDeviceGetInterfaceType"); v.retain=load<decltype(v.retain)>(cf,"CFRetain");
 MD(connect,"AMDeviceConnect"); MD(paired,"AMDeviceIsPaired"); MD(validate,"AMDeviceValidatePairing"); MD(startSession,"AMDeviceStartSession");
 MD(stopSession,"AMDeviceStopSession"); MD(disconnect,"AMDeviceDisconnect"); MD(startService,"AMDeviceSecureStartService");
 MD(recv,"AMDServiceConnectionReceive"); MD(send,"AMDServiceConnectionSend");
 MD(copyValue,"AMDeviceCopyValue");
#undef MD
 v.makeString=load<decltype(v.makeString)>(cf,"CFStringCreateWithCString");
 v.typeID=load<decltype(v.typeID)>(cf,"CFGetTypeID");
 v.stringTypeID=load<decltype(v.stringTypeID)>(cf,"CFStringGetTypeID");
 v.copyString=load<decltype(v.copyString)>(cf,"CFStringGetCString");
 v.release=load<decltype(v.release)>(cf,"CFRelease");
 v.runLoop=load<decltype(v.runLoop)>(cf,"CFRunLoopRunInMode");
 v.mode=*load<Ref*>(cf,"kCFRunLoopDefaultMode");return v;
}
static void ignoreBadFd(const wchar_t*,const wchar_t*,const wchar_t*,unsigned,uintptr_t) {}
static void privateLine(const char* line) {
 auto old=_set_thread_local_invalid_parameter_handler(ignoreBadFd);
 intptr_t fd=_get_osfhandle(3);
 _set_thread_local_invalid_parameter_handler(old);
 if(fd==-1 || fd==-2 || GetFileType((HANDLE)fd)!=FILE_TYPE_PIPE) throw Failure{"private-pipe-required",0};
 DWORD size=(DWORD)std::strlen(line), n=0;
 if(!WriteFile((HANDLE)fd,line,size,&n,nullptr)||n!=size)throw Failure{"private-pipe-write",GetLastError()};
}
static void sendUsbIdentity(Ref dev) {
 Ref key=a.makeString(nullptr,"BluetoothAddress",0x08000100);
 if(!key)throw Failure{"identity-key",0};
 Ref value=a.copyValue(dev,nullptr,key);
 a.release(key);
 char address[20]{};
 bool valid=value && a.typeID(value)==a.stringTypeID() && a.copyString(value,address,sizeof(address),0x08000100);
 if(value)a.release(value);
 valid=valid && std::strlen(address)==17;
 for(size_t i=0;valid && i<17;++i) {
  const char c=address[i];
  valid=i%3==2 ? c==':' : (c>='0' && c<='9') || (c>='a' && c<='f') || (c>='A' && c<='F');
 }
 if(!valid)throw Failure{"identity-unavailable",0};
 address[17]='\n';address[18]=0;
 privateLine(address);
 SecureZeroMemory(address,sizeof(address));
}
static void pump(Ref service) {
 HANDLE input=GetStdHandle(STD_INPUT_HANDLE),output=GetStdHandle(STD_OUTPUT_HANDLE);
 std::thread tx([=]{
  unsigned char b[16384];DWORD n;
  while(ReadFile(input,b,sizeof(b),&n,nullptr)&&n){
   DWORD o=0;while(o<n){int x=a.send(service,b+o,n-o);if(x<=0 || (unsigned)x>n-o){marker("tx-closed");ExitProcess(4);}o+=x;}
  }
  ExitProcess(0);
 });
 tx.detach();
 unsigned char b[16384];for(;;){int n=a.recv(service,b,sizeof(b));if(n<=0){marker("rx-closed");return;}
  if((size_t)n>sizeof(b))throw Failure{"receive-size",0};
  DWORD o=0;while(o<(DWORD)n){DWORD w=0;if(!WriteFile(output,b+o,n-o,&w,nullptr)||!w)return;o+=w;}
 }
}
int wmain(int argc,wchar_t**argv) {
 if(argc!=3 && argc!=4)return 2;
 bool identity=argc==4;
 if(identity && wcscmp(argv[3],L"--usb-identity-fd3")!=0)return 2;
 try {
  a=openAPI(argv[1]);
  if(wcscmp(argv[2],L"--check")==0){if(identity)privateLine("channel-ready\n");marker("api-ready");return 0;}
  wchar_t* end=nullptr;targetID=wcstoul(argv[2],&end,10);if(!targetID || !end || *end) return 2;
  Ref sub=nullptr;check(a.subscribe(onNotice,0,0,nullptr,&sub),"notify");
  auto deadline=GetTickCount64()+10000;
  while(!selected.load() && GetTickCount64()<deadline) a.runLoop(a.mode,0.15,0);
  Ref dev=selected.load();if(!dev)throw Failure{"target-usb-not-found",WAIT_TIMEOUT};
  check(a.connect(dev),"device-connect");marker("usb-connected");
  if(!a.paired(dev))throw Failure{"trust-required",0};check(a.validate(dev),"validate-pairing");
  check(a.startSession(dev),"lockdown-session");marker("trusted-session");
  if(identity)sendUsbIdentity(dev);
  Ref name=a.makeString(nullptr,"com.apple.carkit.service",0x08000100);if(!name)throw Failure{"service-name",0};
  Ref channel=nullptr;int rc=a.startService(dev,name,nullptr,&channel);a.release(name);
  a.stopSession(dev);a.disconnect(dev);check(rc,"start-carkit");if(!channel)throw Failure{"service-null",0};
  marker("service-ready");pump(channel);return 0;
 } catch(const Failure& e){fprintf(stderr,"carkit:failed stage=%s code=0x%08X\n",e.stage,e.code);return 1;}
}
