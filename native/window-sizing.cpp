// SPDX-License-Identifier: GPL-3.0-or-later
#define NOMINMAX
#include <windows.h>
#include <commctrl.h>
#include <node_api.h>
#include <algorithm>
#include <cmath>
#include <cstring>

namespace {
constexpr UINT_PTR subclassId=1;
LRESULT CALLBACK resizeClient(HWND window,UINT message,WPARAM edge,LPARAM parameter,UINT_PTR id,DWORD_PTR reference) {
    if(message==WM_NCDESTROY)RemoveWindowSubclass(window,resizeClient,id);
    if(message!=WM_SIZING||edge<WMSZ_LEFT||edge>WMSZ_BOTTOMRIGHT||!parameter)
        return DefSubclassProc(window,message,edge,parameter);
    RECT outer{},client{};
    if(!GetWindowRect(window,&outer)||!GetClientRect(window,&client))
        return DefSubclassProc(window,message,edge,parameter);
    const LONG frameWidth=(outer.right-outer.left)-(client.right-client.left);
    const LONG frameHeight=(outer.bottom-outer.top)-(client.bottom-client.top);
    auto& bounds=*reinterpret_cast<RECT*>(parameter);
    double ratio;
    static_assert(sizeof(ratio)==sizeof(reference));
    std::memcpy(&ratio,&reference,sizeof(ratio));
    const double width=bounds.right-bounds.left-frameWidth;
    const double height=bounds.bottom-bounds.top-frameHeight;
    const bool horizontal=edge==WMSZ_LEFT||edge==WMSZ_RIGHT;
    const bool vertical=edge==WMSZ_TOP||edge==WMSZ_BOTTOM;
    const auto dpi=GetDpiForWindow(window);
    const double minHeight=std::max({1.0,
        (GetSystemMetricsForDpi(SM_CXMINTRACK,dpi)-frameWidth)/ratio,
        static_cast<double>(GetSystemMetricsForDpi(SM_CYMINTRACK,dpi)-frameHeight)});
    // Project a corner drag onto the aspect ratio while keeping its opposite corner fixed.
    const double fittedHeight=std::max(minHeight,horizontal?width/ratio:vertical?height:
        (width*ratio+height)/(ratio*ratio+1));
    const LONG clientHeight=std::lround(fittedHeight);
    const LONG outerWidth=std::lround(clientHeight*ratio)+frameWidth;
    const LONG outerHeight=clientHeight+frameHeight;
    if(edge==WMSZ_LEFT||edge==WMSZ_TOPLEFT||edge==WMSZ_BOTTOMLEFT)bounds.left=bounds.right-outerWidth;
    else bounds.right=bounds.left+outerWidth;
    if(edge==WMSZ_TOP||edge==WMSZ_TOPLEFT||edge==WMSZ_TOPRIGHT)bounds.top=bounds.bottom-outerHeight;
    else bounds.bottom=bounds.top+outerHeight;
    return TRUE;
}
// Electron exports Node-API from the host executable, including packaged WinPlay.exe.
template<typename Function> Function nodeApi(const char* name) {
    return reinterpret_cast<Function>(GetProcAddress(GetModuleHandleW(nullptr),name));
}
napi_value install(napi_env env,napi_callback_info info) {
    const auto getArgs=nodeApi<decltype(&napi_get_cb_info)>("napi_get_cb_info");
    const auto getBuffer=nodeApi<decltype(&napi_get_buffer_info)>("napi_get_buffer_info");
    const auto getNumber=nodeApi<decltype(&napi_get_value_double)>("napi_get_value_double");
    const auto boolean=nodeApi<decltype(&napi_get_boolean)>("napi_get_boolean");
    if(!getArgs||!getBuffer||!getNumber||!boolean)return nullptr;
    napi_value args[2]{},result{};
    size_t count=2,length=0;
    void* buffer=nullptr;
    HWND window=nullptr;
    double ratio=0;
    bool ok=false;
    if(getArgs(env,info,&count,args,nullptr,nullptr)==napi_ok&&count==2&&
       getBuffer(env,args[0],&buffer,&length)==napi_ok&&length==sizeof(window)&&
       getNumber(env,args[1],&ratio)==napi_ok&&std::isfinite(ratio)&&ratio>0&&ratio<=16384) {
        DWORD_PTR reference=0;
        std::memcpy(&window,buffer,sizeof(window));
        std::memcpy(&reference,&ratio,sizeof(reference));
        if(GetWindowThreadProcessId(window,nullptr)==GetCurrentThreadId())
            ok=SetWindowSubclass(window,resizeClient,subclassId,reference)!=FALSE;
    }
    return boolean(env,ok,&result)==napi_ok?result:nullptr;
}
}
NAPI_MODULE_INIT() {
    const auto create=nodeApi<decltype(&napi_create_function)>("napi_create_function");
    napi_value fn{};
    return create&&create(env,"setClientAspectRatio",NAPI_AUTO_LENGTH,install,nullptr,&fn)==napi_ok?fn:exports;
}
