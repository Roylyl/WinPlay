// SPDX-License-Identifier: GPL-3.0-or-later
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <appmodel.h>
#include <cfgmgr32.h>
#include <iphlpapi.h>
#include <netioapi.h>
#include <cstdio>
#include <cwchar>
#include <string>
#include <vector>
#include "apple-parent.h"
#include <initguid.h>
#include <devpkey.h>

#pragma comment(lib,"cfgmgr32.lib")
#pragma comment(lib,"iphlpapi.lib")
#pragma comment(lib,"ws2_32.lib")
#pragma comment(lib,"ole32.lib")
#pragma comment(lib,"advapi32.lib")

namespace {
using namespace winplay_usb;
constexpr wchar_t applePrefix[]=L"USB\\VID_05AC&PID_";
std::wstring property(DEVINST device,const DEVPROPKEY& key) {
    wchar_t value[256]{};
    DEVPROPTYPE type{};
    ULONG bytes=sizeof(value);
    if(CM_Get_DevNode_PropertyW(device,&key,&type,reinterpret_cast<PBYTE>(value),&bytes,0)!=CR_SUCCESS ||
       type!=DEVPROP_TYPE_STRING || bytes<sizeof(wchar_t) || bytes>sizeof(value) ||
       bytes%sizeof(wchar_t)!=0 || value[(bytes/sizeof(wchar_t))-1]!=L'\0') return {};
    return value;
}
std::vector<wchar_t> presentIds() {
    ULONG size{};
    constexpr ULONG flags=CM_GETIDLIST_FILTER_PRESENT;
    checkConfigManager(CM_Get_Device_ID_List_SizeW(&size,nullptr,flags),"device-list-size");
    std::vector<wchar_t> data(size);
    checkConfigManager(CM_Get_Device_ID_ListW(nullptr,data.data(),size,flags),"device-list");
    return data;
}
std::string quote(const std::wstring& value) {
    int size=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value.data(),static_cast<int>(value.size()),nullptr,0,nullptr,nullptr);
    std::string utf8(size,'\0');
    if(size)WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value.data(),static_cast<int>(value.size()),utf8.data(),size,nullptr,nullptr);
    std::string escaped="\"";
    for(unsigned char ch:utf8) {
        if(ch=='"'||ch=='\\')escaped+='\\';
        if(ch<32) {
            char hex[7]{};
            std::snprintf(hex,sizeof(hex),"\\u%04x",static_cast<unsigned>(ch));
            escaped+=hex;
        } else escaped+=static_cast<char>(ch);
    }
    return escaped+'"';
}
void printAppleRuntimePaths() {
    constexpr wchar_t family[]=L"AppleInc.AppleDevices_nzyj5cx40ttqa";
    UINT32 count=0,chars=0;
    const auto status=GetPackagesByPackageFamily(family,&count,nullptr,&chars,nullptr);
    if(status!=ERROR_INSUFFICIENT_BUFFER||!count||!chars){std::puts("[]");return;}
    std::vector<PWSTR> names(count);
    std::vector<wchar_t> buffer(chars);
    if(GetPackagesByPackageFamily(family,&count,names.data(),&chars,buffer.data())!=ERROR_SUCCESS){
        std::puts("[]");return;
    }
    std::string out="[";
    for(UINT32 i=0;i<count;i++){
        UINT32 length=0;
        if(GetPackagePathByFullName(names[i],&length,nullptr)!=ERROR_INSUFFICIENT_BUFFER||!length)continue;
        std::wstring directory(length,L'\0');
        if(GetPackagePathByFullName(names[i],&length,directory.data())!=ERROR_SUCCESS||!length)continue;
        directory.resize(length-1);
        if(out.size()>1)out+=',';
        out+=quote(directory);
    }
    std::puts((out+"]").c_str());
}
void printParents() {
    auto ids=presentIds();
    std::string out="[";
    for(auto id=ids.data();*id;id+=std::wcslen(id)+1) {
        if(_wcsnicmp(id,applePrefix,ARRAYSIZE(applePrefix)-1)!=0)continue;
        try{targetProductId(id);}catch(const Error&){continue;}
        DEVINST node{};
        if(CM_Locate_DevNodeW(&node,id,CM_LOCATE_DEVNODE_NORMAL)!=CR_SUCCESS)continue;
        const auto name=property(node,DEVPKEY_Device_BusReportedDeviceDesc);
        if(_wcsicmp(property(node,DEVPKEY_Device_Service).c_str(),L"usbccgp")!=0&&_wcsnicmp(name.c_str(),L"iPhone",6)!=0)continue;
        if(out.size()>1)out+=',';
        out+="{\"parentInstance\":"+quote(id)+",\"product\":"+quote(name)+"}";
    }
    std::puts((out+"]").c_str());
}
bool findInterface(DEVINST node, NET_LUID& luid) {
    wchar_t id[64]{};
    HKEY key{};
    if(CM_Open_DevNode_Key(node,KEY_READ,0,RegDisposition_OpenExisting,&key,CM_REGISTRY_SOFTWARE)!=CR_SUCCESS)return false;
    DWORD size=sizeof(id);
    const auto result=RegGetValueW(key,nullptr,L"NetCfgInstanceId",RRF_RT_REG_SZ,nullptr,id,&size);
    RegCloseKey(key);
    GUID guid{};
    return result==ERROR_SUCCESS && CLSIDFromString(id,&guid)==S_OK && ConvertInterfaceGuidToLuid(&guid,&luid)==NO_ERROR;
}
bool linkLocal(const IN6_ADDR& value) { return value.u.Byte[0]==0xfe&&(value.u.Byte[1]&0xc0)==0x80; }
std::string scopeAddress(const IN6_ADDR& value) {
    char text[INET6_ADDRSTRLEN]{};
    return InetNtopA(AF_INET6,&value,text,ARRAYSIZE(text))?text:"";
}
std::string adapterJson(NET_LUID luid) {
    MIB_IF_ROW2 adapter{};
    adapter.InterfaceLuid=luid;
    if(GetIfEntry2(&adapter)!=NO_ERROR||adapter.AdminStatus!=NET_IF_ADMIN_STATUS_UP||adapter.PhysicalAddressLength!=6)return {};
    PMIB_UNICASTIPADDRESS_TABLE addresses{};
    if(GetUnicastIpAddressTable(AF_INET6,&addresses)!=NO_ERROR)return {};
    std::string local;
    unsigned matches=0;
    for(ULONG i=0;i<addresses->NumEntries;i++) {
        const auto& row=addresses->Table[i];
        if(row.InterfaceLuid.Value!=luid.Value||(row.DadState!=IpDadStatePreferred&&row.DadState!=IpDadStateDeprecated))continue;
        const auto& addr=row.Address.Ipv6.sin6_addr;
        if(linkLocal(addr)){local=scopeAddress(addr);matches++;}
    }
    FreeMibTable(addresses);
    if(matches!=1||local.empty())return {};
    std::string peer;
    bool ambiguous=false;
    PMIB_IPFORWARD_TABLE2 routes{};
    if(GetIpForwardTable2(AF_INET6,&routes)==NO_ERROR) {
        for(ULONG i=0;i<routes->NumEntries;i++) {
            const auto& route=routes->Table[i];
            if(route.InterfaceLuid.Value!=luid.Value||route.DestinationPrefix.PrefixLength!=0)continue;
            const auto& addr=route.NextHop.Ipv6.sin6_addr;
            if(!linkLocal(addr))continue;
            const auto found=scopeAddress(addr);
            if(!peer.empty()&&found!=peer)ambiguous=true;
            peer=found;
        }
        FreeMibTable(routes);
    }
    char formatted[18]{};
    const auto* m=adapter.PhysicalAddress;
    std::snprintf(formatted,sizeof(formatted),"%02X:%02X:%02X:%02X:%02X:%02X",
        static_cast<unsigned>(m[0]),static_cast<unsigned>(m[1]),static_cast<unsigned>(m[2]),
        static_cast<unsigned>(m[3]),static_cast<unsigned>(m[4]),static_cast<unsigned>(m[5]));
    return "{\"ifIndex\":"+std::to_string(adapter.InterfaceIndex)+",\"local\":\""+local+
        "\",\"mac\":\""+formatted+"\",\"peer\":"+(peer.empty()||ambiguous?"null":"\""+peer+"\"")+"}";
}
bool scanAdapters(DEVINST node,const wchar_t* suffix,unsigned depth,bool targetFunction,std::string& found) {
    if(depth==0)return true;
    DEVINST child{};
    if(CM_Get_Child(&child,node,0)==CR_SUCCESS) {
        do {
            const auto id=instanceId(child);
            const auto split=id.rfind(L'\\');
            const bool matched=targetFunction||(split!=std::wstring::npos&&split>=6&&
                _wcsnicmp(id.c_str(),applePrefix,ARRAYSIZE(applePrefix)-1)==0&&
                _wcsnicmp(id.c_str()+split-6,suffix,6)==0);
            if(matched&&_wcsicmp(property(child,DEVPKEY_Device_Service).c_str(),L"UsbNcm")==0) {
                NET_LUID luid{};
                const auto candidate=findInterface(child,luid)?adapterJson(luid):std::string{};
                if(!candidate.empty()) {
                    if(!found.empty())return false;
                    found=candidate;
                }
            }
            if(!scanAdapters(child,suffix,depth-1,matched,found))return false;
        }while(CM_Get_Sibling(&child,child,0)==CR_SUCCESS);
    }
    return true;
}
void printAdapter(const std::wstring& parent,unsigned mi) {
    targetProductId(parent);
    DEVINST node{};
    auto instance=parent;
    if(CM_Locate_DevNodeW(&node,instance.data(),CM_LOCATE_DEVNODE_NORMAL)!=CR_SUCCESS) {
        std::puts("null");return;
    }
    wchar_t suffix[7]{};
    swprintf_s(suffix,L"&MI_%02X",mi);
    std::string found;
    const bool unique=scanAdapters(node,suffix,6,false,found);
    std::puts(unique&&!found.empty()?found.c_str():"null");
}
}

int wmain(int argc,wchar_t** argv) {
    try {
        if(argc==2&&std::wcscmp(argv[1],L"--parents")==0){printParents();return 0;}
        if(argc==2&&std::wcscmp(argv[1],L"--apple-runtime")==0){printAppleRuntimePaths();return 0;}
        if(argc==4&&std::wcscmp(argv[1],L"--ncm")==0) {
            wchar_t* end=nullptr;
            const auto mi=std::wcstoul(argv[3],&end,10);
            if(!argv[3][0]||*end||mi>255)return 2;
            printAdapter(argv[2],static_cast<unsigned>(mi));
            return 0;
        }
        return 2;
    } catch(const Error& error) {
        std::fprintf(stderr,"stage=%s code=%u\n",error.stage,error.code);return 1;
    }
}
