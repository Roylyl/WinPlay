# WinPlay源码来源与无线路径

WinPlay无线引导参考用户提供的Roylyl/AndroidPlay源码，局域网方案及网络协议参考Roylyl/MacPlay。当前版本只包含无线连接实现。

## 蓝牙引导

Windows蓝牙配对后，通过AF_BTH/RFCOMM连接iPhone的服务UUID`00000000-deca-fade-deca-deafdecacafe`。`src/engine/iap.ts`执行检测/同步、配件识别、MFi认证，响应热点信息请求和传输标识通知，再发送无线CarPlay启动参数。认证与握手消息沿用已工作的无线分支。

## 无线网络

`src/engine/discovery.ts`在所选网络接口广播`_airplay._tcp`，发现`_carplay-ctrl._tcp`并请求连接。网络控制通道就绪后重新进行iAP2识别和认证，再释放蓝牙引导。本机热点和现有局域网分别保存SSID、密码、信道和网卡选择。

网络协议复用MacPlay的SRP、Ed25519/X25519、HKDF、ChaCha20-Poly1305、二进制plist、视频/音频协商与HID输入。独立Node.js进程运行协议，Electron通过WebCodecs解码视频与音频。PCM等共享媒体格式处理保留用于协议兼容，不包含设备驱动或其他物理传输实现。

## 认证与许可证

本地认证文件由用户提供。上游NOTICE记载历史实验材料来自DiPlay0.2.6APK，再分发授权尚未确认。导入只验证格式和公钥匹配，最终由iPhone验证。GPL许可及LIVI/DiPlay来源声明保留在项目LICENSE、NOTICE与vendor目录。

## Windows移植残留检查

已清理上游平台专用的运行字段和不可达实现：调试变量改为`WINPLAY_DEBUG`；对iPhone上报的触摸、旋钮、媒体和电话HID设备名称统一使用WinPlay；删除Linux/GStreamer视频路径、原生插件占位接口、主机/插件音频分支、无效的控制套接字常量，以及未被Windows实现使用的AndroidAuto和投屏命令枚举。

Windows音频接收直接使用UDP接收器，视频直接使用`ScreenStream`接收加密TCP数据，再由Electron/WebCodecs解码。构建会清除没有对应TypeScript源码的旧编译模块，避免已删除的平台实现进入安装包。

保留AndroidPlay、MacPlay、LIVI和DiPlay的来源注释、许可证与项目介绍；它们不是运行平台字段。`btMac`和`apMac`表示蓝牙或接入点的MAC地址，AirPlay服务名、协议版本、UUID、音频格式位和HID描述符属于协议兼容数据，不能作为平台残留删除。

iPhone端识别字段包括iAP配件名称/型号、Bonjour服务名称/TXT型号、CarPlay`/info`名称/车型及OEM标签，统一为WinPlay。协议检查直接解析生成的iAP消息与二进制plist，不通过README推断车型。

同步参考MacPlay1.2.0的完整会话TEARDOWN收尾、页面排布与关于页更新入口；Windows热点按ICS私有共享接口检测，日志在保存、打开和导出时统一脱敏。AndroidPlay新版本的AGPL实现没有直接复制进WinPlay。

本次通过本机编译、加密音视频协议检查及合成窗口检查验证。无线真机测试仍由用户进行，不将合成检查表述为真实iPhone连接验证。
