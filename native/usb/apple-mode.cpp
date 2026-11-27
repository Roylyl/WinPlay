#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <initguid.h>
#include <cfgmgr32.h>
#include <devpkey.h>
#include <algorithm>
#include <array>
#include <cstdio>
#include <vector>
#include "apple-parent.h"

#pragma comment(lib,"cfgmgr32.lib")

namespace {
using namespace winplay_usb;
constexpr GUID appleCompat{0xf0b32be3,0x6678,0x4879,{0x92,0x30,0xe4,0x38,0x45,0xd8,0x05,0xee}};
// Control-transfer interface exposed by the Apple Windows compatibility driver.
// This endpoint is used only with the two fixed requests in run().
constexpr DWORD appleControlTransfer = 0x2200a0;

std::wstring property(DEVINST node, const DEVPROPKEY& key) {
    wchar_t buffer[256]{};
    DEVPROPTYPE type{};
    ULONG length = sizeof(buffer);
    checkConfigManager(CM_Get_DevNode_PropertyW(node,&key,&type,reinterpret_cast<PBYTE>(buffer),&length,0),
                       "read-driver-property");
    require(type==DEVPROP_TYPE_STRING && length>=sizeof(wchar_t) && length<=sizeof(buffer) &&
            length%sizeof(wchar_t)==0 && buffer[length/sizeof(wchar_t)-1]==0,"driver-property-format");
    return buffer;
}

bool appleDriver(DEVINST node) {
    const auto provider = property(node, DEVPKEY_Device_DriverProvider);
    return _wcsicmp(provider.c_str(),L"Apple, Inc.")==0 || _wcsicmp(provider.c_str(),L"Apple Inc.")==0 ||
           _wcsicmp(provider.c_str(),L"Apple Inc")==0 || _wcsicmp(provider.c_str(),L"Apple, Inc")==0;
}

std::wstring compatibilityPath(std::wstring parentId, unsigned mux) {
    DEVINST parent{};
    checkConfigManager(CM_Locate_DevNodeW(&parent,parentId.data(),CM_LOCATE_DEVNODE_NORMAL),"parent-present");
    require(_wcsicmp(instanceId(parent).c_str(),parentId.c_str())==0 &&
            _wcsicmp(property(parent,DEVPKEY_Device_Service).c_str(),L"usbccgp")==0 &&
            appleDriver(parent),"unexpected-parent-driver");
    wchar_t suffix[16]{};
    swprintf_s(suffix,L"&MI_%02X\\",mux);
    const auto prefix=parentId.substr(0,parentId.rfind(L'\\')) + suffix;
    DEVINST child{};
    CONFIGRET status=CM_Get_Child(&child,parent,0);
    std::wstring matched;
    while(status==CR_SUCCESS) {
        const auto id=instanceId(child);
        if(_wcsnicmp(prefix.c_str(),id.c_str(),prefix.size())==0) {
            require(matched.empty(),"ambiguous-usbmux-function");
            require(_wcsicmp(property(child,DEVPKEY_Device_Service).c_str(),L"WinUSB")==0 &&
                    appleDriver(child),"unexpected-usbmux-driver");
            matched=id;
        }
        DEVINST sibling{};
        status=CM_Get_Sibling(&sibling,child,0);
        child=sibling;
    }
    if(status!=CR_NO_SUCH_DEVNODE) checkConfigManager(status,"locate-usbmux-child");
    require(!matched.empty(),"usbmux-child-unavailable");

    ULONG count{};
    checkConfigManager(CM_Get_Device_Interface_List_SizeW(&count,const_cast<GUID*>(&appleCompat),matched.data(),
                       CM_GET_DEVICE_INTERFACE_LIST_PRESENT),"compat-interface-size");
    require(count>1 && count<=32768,"compat-interface-not-present");
    std::vector<wchar_t> paths(count);
    checkConfigManager(CM_Get_Device_Interface_ListW(const_cast<GUID*>(&appleCompat),matched.data(),paths.data(),
                       count,CM_GET_DEVICE_INTERFACE_LIST_PRESENT),"compat-interface-list");
    const auto length=wcsnlen_s(paths.data(),count);
    require(length>0 && length+1<count && paths[length+1]==0,"ambiguous-compat-interface");
    return paths.data();
}

unsigned byteArgument(const wchar_t* arg) {
    require(arg && *arg && wcslen(arg)<=3,"invalid-byte-argument");
    unsigned value=0;
    for(const wchar_t* c=arg;*c;++c) {
        require(*c>=L'0' && *c<=L'9',"invalid-byte-argument");
        value=value*10+(*c-L'0');
    }
    require(value<=255,"invalid-byte-argument");
    return value;
}

struct Handle {
    explicit Handle(HANDLE value) : h(value) {}
    ~Handle() { if(h && h != INVALID_HANDLE_VALUE) CloseHandle(h); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    HANDLE h;
};
template<size_t N>
std::array<BYTE,N> transfer(HANDLE device, const std::array<BYTE,8>& setup, const char* stage) {
    std::array<BYTE,8+N> frame{};
    std::copy(setup.begin(),setup.end(),frame.begin());
    Handle event{CreateEventW(nullptr,TRUE,FALSE,nullptr)};
    if(!event.h) throw Error{"event",GetLastError()};
    OVERLAPPED ov{};
    ov.hEvent=event.h;
    constexpr DWORD total=static_cast<DWORD>(8+N);
    DWORD done=0;
    if(!DeviceIoControl(device,appleControlTransfer,frame.data(),total,frame.data(),total,nullptr,&ov)){
        DWORD error=GetLastError();
        if(error!=ERROR_IO_PENDING) throw Error{stage,error};
    }
    if(WaitForSingleObject(event.h,3000)!=WAIT_OBJECT_0){
        CancelIoEx(device,&ov);
        GetOverlappedResult(device,&ov,&done,TRUE); // Preserve OVERLAPPED and its buffer until cancellation completes.
        throw Error{stage,ERROR_TIMEOUT};
    }
    if(!GetOverlappedResult(device,&ov,&done,FALSE)) throw Error{stage,GetLastError()};
    require(done==total,"invalid-reply-length");
    std::array<BYTE,N> payload{};
    std::copy(frame.begin()+8,frame.end(),payload.begin());
    return payload;
}

void run(const wchar_t* instance,unsigned mux,unsigned count,bool requestMode) {
    const auto product=targetProductId(instance);
    require(count>0,"empty-configuration-snapshot");
    const auto path=compatibilityPath(instance,mux);
    Handle device{CreateFileW(path.c_str(),GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,
                              nullptr,OPEN_EXISTING,FILE_FLAG_OVERLAPPED,nullptr)};
    if(device.h==INVALID_HANDLE_VALUE) throw Error{"open-compat-interface",GetLastError()};
    const auto d=transfer<18>(device.h,{0x80,6,0,1,0,0,18,0},"read-device-descriptor");
    require(d[0]==18 && d[1]==1 && d[8]==0xac && d[9]==0x05 &&
            static_cast<unsigned>(d[10]|(d[11]<<8))==product,"descriptor-target-mismatch");
    require(d[17]==count,"configuration-snapshot-changed");
    if(requestMode) {
        // Recheck the parent/child relation immediately before using the already-open handle.
        require(_wcsicmp(path.c_str(),compatibilityPath(instance,mux).c_str())==0,"target-changed");
        auto reply=transfer<1>(device.h,{0xc0,0x52,0,0,4,0,1,0},"mode4-no-confirmed-response");
        require(reply[0]==0,"mode4-rejected");
    }
    printf("{\"action\":\"%s\",\"configurationCount\":%u,\"usbMuxInterface\":%u}\n",
           requestMode?"mode4-acknowledged":"descriptor-confirmed",count,mux);
}
VOID CALLBACK timeout(PVOID,BOOLEAN) {
    DWORD written{};
    const char text[]="stage=deadline-exceeded\n";
    WriteFile(GetStdHandle(STD_ERROR_HANDLE),text,sizeof(text)-1,&written,nullptr);
    TerminateProcess(GetCurrentProcess(),4);
}
}
int wmain(int argc,wchar_t** argv) {
    if(argc!=6 || wcscmp(argv[1],L"--parent-instance") ||
       (wcscmp(argv[5],L"--descriptor") && wcscmp(argv[5],L"--request-mode4"))) {
        fputs("Use node prepare.cjs --parent-instance <Apple USB parent> [--request-mode4]\n",stderr);
        return 2;
    }
    HANDLE timer{};
    if(!CreateTimerQueueTimer(&timer,nullptr,timeout,nullptr,11000,0,WT_EXECUTEONLYONCE)) return 3;
    int result=0;
    try { run(argv[2],byteArgument(argv[3]),byteArgument(argv[4]),wcscmp(argv[5],L"--request-mode4")==0); }
    catch(const winplay_usb::Error& e) { fprintf(stderr,"stage=%s code=%u\n",e.stage,e.code); result=1; }
    catch(...) { fputs("stage=unexpected-error\n",stderr); result=1; }
    DeleteTimerQueueTimer(nullptr,timer,INVALID_HANDLE_VALUE);
    return result;
}
