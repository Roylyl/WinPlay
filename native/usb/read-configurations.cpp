// Standalone Windows SDK tool. Only the parent hub is opened, with zero requested access.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <initguid.h>
#include <cfgmgr32.h>
#include <devpkey.h>
#include <winioctl.h>
#include <usbiodef.h>
#include <usbioctl.h>
#include <cstddef>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <string>
#include <vector>
#include "apple-parent.h"

#pragma comment(lib, "cfgmgr32.lib")

namespace {
using namespace winplay_usb;

struct Target {
    std::wstring hubInstance;
    std::wstring driverKey;
    ULONG port;
};

Target locate(std::wstring instance) {
    DEVINST device{}, hub{};
    checkConfigManager(CM_Locate_DevNodeW(&device, &instance[0], CM_LOCATE_DEVNODE_NORMAL), "target-present");
    require(_wcsicmp(instanceId(device).c_str(), instance.c_str()) == 0, "target-instance-mismatch");
    checkConfigManager(CM_Get_Parent(&hub, device, 0), "parent-hub");
    DEVPROPTYPE type{};
    ULONG port{}, bytes = sizeof(port);
    checkConfigManager(CM_Get_DevNode_PropertyW(device, &DEVPKEY_Device_Address, &type,
        reinterpret_cast<PBYTE>(&port), &bytes, 0), "target-port");
    require(type == DEVPROP_TYPE_UINT32 && bytes == sizeof(port) && port >= 1 && port <= 255,
            "target-port-format");
    wchar_t key[512]{};
    bytes = sizeof(key);
    checkConfigManager(CM_Get_DevNode_PropertyW(device, &DEVPKEY_Device_Driver, &type,
        reinterpret_cast<PBYTE>(key), &bytes, 0), "target-driver-key");
    require(type == DEVPROP_TYPE_STRING && bytes >= 2 * sizeof(wchar_t) && bytes <= sizeof(key) &&
            bytes % sizeof(wchar_t) == 0 && key[0] && key[bytes / sizeof(wchar_t) - 1] == L'\0',
            "target-driver-key-format");
    return {instanceId(hub), key, port};
}

class Hub {
public:
    explicit Hub(std::wstring instance) {
        GUID interfaceClass = GUID_DEVINTERFACE_USB_HUB;
        ULONG chars{};
        checkConfigManager(CM_Get_Device_Interface_List_SizeW(&chars, &interfaceClass, &instance[0],
            CM_GET_DEVICE_INTERFACE_LIST_PRESENT), "hub-interface-size");
        require(chars >= 2 && chars <= 32768, "hub-interface-not-found");
        std::vector<wchar_t> paths(chars);
        checkConfigManager(CM_Get_Device_Interface_ListW(&interfaceClass, &instance[0], paths.data(),
            chars, CM_GET_DEVICE_INTERFACE_LIST_PRESENT), "hub-interface");
        const size_t length = wcsnlen_s(paths.data(), chars);
        require(length && length + 1 < chars && paths[length + 1] == L'\0', "ambiguous-hub-interface");
        file = CreateFileW(paths.data(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);
        if (file == INVALID_HANDLE_VALUE) throw Error{"open-hub", GetLastError()};
    }
    ~Hub() { CloseHandle(file); }
    Hub(const Hub&) = delete;
    Hub& operator=(const Hub&) = delete;

    DWORD query(DWORD operation, void* data, DWORD bytes, const char* stage) const {
        DWORD returned{};
        if (!DeviceIoControl(file, operation, data, bytes, data, bytes, &returned, nullptr))
            throw Error{stage, GetLastError()};
        require(returned <= bytes, "invalid-hub-response");
        return returned;
    }
private:
    HANDLE file = INVALID_HANDLE_VALUE;
};

void verifyPortOwner(const Hub& hub, const Target& target) {
    constexpr auto start = offsetof(USB_NODE_CONNECTION_DRIVERKEY_NAME, DriverKeyName);
    std::vector<BYTE> data(sizeof(USB_NODE_CONNECTION_DRIVERKEY_NAME) +
                           (target.driverKey.size() + 1) * sizeof(wchar_t));
    auto* reply = reinterpret_cast<USB_NODE_CONNECTION_DRIVERKEY_NAME*>(data.data());
    reply->ConnectionIndex = target.port;
    const DWORD returned = hub.query(IOCTL_USB_GET_NODE_CONNECTION_DRIVERKEY_NAME, reply,
        static_cast<DWORD>(data.size()), "hub-port-driver-key");
    require(reply->ActualLength >= start + sizeof(wchar_t) && reply->ActualLength <= returned,
            "hub-port-driver-key-length");
    const size_t available = (reply->ActualLength - start) / sizeof(wchar_t);
    require(wcsnlen_s(reply->DriverKeyName, available) == target.driverKey.size() &&
            target.driverKey.size() < available &&
            _wcsicmp(reply->DriverKeyName, target.driverKey.c_str()) == 0, "hub-port-target-changed");
}

struct Connection {
    USHORT address;
    UCHAR active, count;
};

Connection connection(const Hub& hub, ULONG port, unsigned product) {
    std::vector<BYTE> data(sizeof(USB_NODE_CONNECTION_INFORMATION_EX) + 32 * sizeof(USB_PIPE_INFO));
    auto* info = reinterpret_cast<USB_NODE_CONNECTION_INFORMATION_EX*>(data.data());
    info->ConnectionIndex = port;
    const DWORD returned = hub.query(IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX, info,
        static_cast<DWORD>(data.size()), "connection-info");
    require(returned >= offsetof(USB_NODE_CONNECTION_INFORMATION_EX, PipeList) &&
            info->ConnectionStatus == DeviceConnected && !info->DeviceIsHub &&
            info->DeviceDescriptor.bLength == sizeof(USB_DEVICE_DESCRIPTOR) &&
            info->DeviceDescriptor.bDescriptorType == USB_DEVICE_DESCRIPTOR_TYPE &&
            info->DeviceDescriptor.idVendor == 0x05ac && info->DeviceDescriptor.idProduct == product &&
            info->DeviceDescriptor.bNumConfigurations > 0, "connection-target-mismatch");
    return {info->DeviceAddress, info->CurrentConfigurationValue, info->DeviceDescriptor.bNumConfigurations};
}

std::vector<BYTE> configDescriptor(const Hub& hub, ULONG port, unsigned index, USHORT length) {
    constexpr auto prefix = offsetof(USB_DESCRIPTOR_REQUEST, Data);
    std::vector<BYTE> data(prefix + length);
    auto* req = reinterpret_cast<USB_DESCRIPTOR_REQUEST*>(data.data());
    req->ConnectionIndex = port;
    req->SetupPacket.bmRequest = 0x80;
    req->SetupPacket.bRequest = USB_REQUEST_GET_DESCRIPTOR;
    req->SetupPacket.wValue = static_cast<USHORT>((USB_CONFIGURATION_DESCRIPTOR_TYPE << 8) | index);
    req->SetupPacket.wLength = length;
    const DWORD returned = hub.query(IOCTL_USB_GET_DESCRIPTOR_FROM_NODE_CONNECTION,
        req, static_cast<DWORD>(data.size()), "read-config-descriptor");
    require(returned == data.size() && req->Data[0] == sizeof(USB_CONFIGURATION_DESCRIPTOR) &&
            req->Data[1] == USB_CONFIGURATION_DESCRIPTOR_TYPE, "incomplete-config-descriptor");
    return {data.begin() + prefix, data.end()};
}

std::string snapshot(const std::wstring& instance, unsigned product) {
    const auto target = locate(instance);
    const Hub hub(target.hubInstance);
    verifyPortOwner(hub, target);
    const auto before = connection(hub, target.port, product);
    bool activeListed = before.active == 0; // Zero is the unconfigured state.
    std::string json = "{\"activeValue\":" + std::to_string(before.active) + ",\"configurations\":[";
    constexpr char digits[] = "0123456789abcdef";
    for (unsigned i = 0; i < before.count; ++i) {
        const auto header = configDescriptor(hub, target.port, i, sizeof(USB_CONFIGURATION_DESCRIPTOR));
        const auto size = static_cast<USHORT>(header[2] | (static_cast<unsigned>(header[3]) << 8));
        require(size >= header.size(), "invalid-config-length");
        const auto full = configDescriptor(hub, target.port, i, size);
        require(std::memcmp(header.data(), full.data(), header.size()) == 0, "config-changed");
        if (full[offsetof(USB_CONFIGURATION_DESCRIPTOR, bConfigurationValue)] == before.active)
            activeListed = true;
        verifyPortOwner(hub, target);
        if (i) json.push_back(',');
        json.push_back('"');
        for (BYTE b : full) {
            json.push_back(digits[b >> 4]);
            json.push_back(digits[b & 15]);
        }
        json.push_back('"');
    }
    const auto after = connection(hub, target.port, product);
    const auto current = locate(instance);
    require(before.address == after.address && before.active == after.active && before.count == after.count &&
            current.port == target.port && _wcsicmp(current.hubInstance.c_str(), target.hubInstance.c_str()) == 0 &&
            _wcsicmp(current.driverKey.c_str(), target.driverKey.c_str()) == 0, "target-changed-during-read");
    verifyPortOwner(hub, target);
    require(activeListed, "active-configuration-not-listed");
    return json + "]}";
}

void refreshApplePort(const std::wstring& instance, unsigned product) {
    DEVINST device{};
    checkConfigManager(CM_Locate_DevNodeW(&device, const_cast<wchar_t*>(instance.c_str()), CM_LOCATE_DEVNODE_NORMAL), "target-present");
    wchar_t service[32]{}, provider[64]{};
    DEVPROPTYPE type{};
    ULONG length=sizeof(service);
    checkConfigManager(CM_Get_DevNode_PropertyW(device, &DEVPKEY_Device_Service, &type,
        reinterpret_cast<PBYTE>(service), &length, 0), "target-parent-service");
    require(type==DEVPROP_TYPE_STRING && _wcsicmp(service,L"usbccgp")==0,"target-parent-service");
    length=sizeof(provider);
    checkConfigManager(CM_Get_DevNode_PropertyW(device, &DEVPKEY_Device_DriverProvider, &type,
        reinterpret_cast<PBYTE>(provider), &length, 0), "target-parent-provider");
    require(type==DEVPROP_TYPE_STRING && (_wcsnicmp(provider,L"Apple",5)==0),"target-parent-provider");
    const auto target=locate(instance);
    const Hub hub(target.hubInstance);
    verifyPortOwner(hub,target);
    const auto before=connection(hub,target.port,product);
    const auto current=locate(instance);
    require(current.port==target.port && current.hubInstance==target.hubInstance &&
            current.driverKey==target.driverKey,"target-moved");
    const auto after=connection(hub,target.port,product);
    require(before.address==after.address && before.active==after.active && before.count==after.count,"connection-changed");
    verifyPortOwner(hub,current);
    USB_CYCLE_PORT_PARAMS params{current.port,0};
    hub.query(IOCTL_USB_HUB_CYCLE_PORT,&params,sizeof(params),"refresh-target-port");
    require(params.StatusReturned==0,"refresh-target-port-status");
}
}

int wmain(int argc, wchar_t** argv) {
    if (argc != 3 || (std::wcscmp(argv[1], L"--parent-instance") != 0 && std::wcscmp(argv[1], L"--cycle-port") != 0)) {
        std::fputs("usage: UsbReadConfigurations --parent-instance|--cycle-port <Apple USB parent instance>\n", stderr);
        return 2;
    }
    try {
        const std::wstring instance(argv[2]);
        if(std::wcscmp(argv[1],L"--cycle-port")==0){
            refreshApplePort(instance,targetProductId(instance));
            return 0;
        }
        const auto result = snapshot(instance, targetProductId(instance));
        return std::puts(result.c_str()) == EOF ? 1 : 0;
    } catch (const Error& error) {
        std::fprintf(stderr, "stage=%s code=%u\n", error.stage, error.code);
    } catch (...) {
        std::fputs("stage=unexpected-error\n", stderr);
    }
    return 1;
}
