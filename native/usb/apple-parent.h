#pragma once
#include <windows.h>
#include <cfgmgr32.h>
#include <cwchar>
#include <string>

namespace winplay_usb {
struct Error { const char* stage; unsigned code; };

inline void require(bool condition, const char* stage) {
    if (!condition) throw Error{stage, ERROR_INVALID_DATA};
}

inline void checkConfigManager(CONFIGRET result, const char* stage) {
    if (result != CR_SUCCESS) throw Error{stage, result};
}

inline unsigned targetProductId(const std::wstring& instance) {
    constexpr wchar_t prefix[] = L"USB\\VID_05AC&PID_";
    constexpr size_t prefixLength = ARRAYSIZE(prefix) - 1;
    require(instance.size() > prefixLength + 5 && instance.size() < MAX_DEVICE_ID_LEN &&
            _wcsnicmp(instance.c_str(), prefix, prefixLength) == 0 &&
            instance[prefixLength + 4] == L'\\' &&
            instance.find(L'\\', prefixLength + 5) == std::wstring::npos, "parent-instance-format");
    unsigned product = 0;
    for (size_t i = prefixLength; i < prefixLength + 4; ++i) {
        wchar_t c = instance[i];
        if (c >= L'a' && c <= L'f') c -= L'a' - L'A';
        require((c >= L'0' && c <= L'9') || (c >= L'A' && c <= L'F'), "parent-instance-format");
        product = product * 16 + (c <= L'9' ? c - L'0' : c - L'A' + 10);
    }
    return product;
}

inline std::wstring instanceId(DEVINST device) {
    wchar_t id[MAX_DEVICE_ID_LEN]{};
    checkConfigManager(CM_Get_Device_IDW(device, id, ARRAYSIZE(id), 0), "device-instance");
    return id;
}
}
