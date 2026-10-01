<p align="center"><img src="resources/icons/winplay-256.png" width="104" alt="WinPlay应用图标"></p>

<h1 align="center">WinPlay</h1>

<p align="center">让Windows电脑成为无线CarPlay接收端，使用本机移动热点或现有局域网显示和操作iPhone的CarPlay界面。</p>

<p align="center">
  <a href="package.json"><img src="https://img.shields.io/badge/version-1.1.0-2563eb?style=flat-square" alt="版本1.1.0"></a>
  <a href="#使用条件"><img src="https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-555555?style=flat-square" alt="运行平台"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-2563eb?style=flat-square" alt="项目许可"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/build-Electron-555555?style=flat-square" alt="Electron桌面应用"></a>
</p>

<p align="center"><a href="#快速入门">快速入门</a> · <a href="#主要功能">主要功能</a> · <a href="#其他平台">其他平台</a> · <a href="#从源码构建">源码构建</a> · <a href="#来源与许可">来源与许可</a></p>

<p align="center">其他设备：<a href="https://github.com/Roylyl/MacPlay">MacPlay</a> · <a href="https://github.com/Roylyl/AndroidPlay">AndroidPlay</a></p>

## 快速入门

### 使用条件

- Windows10/11x64，具备蓝牙与Wi-Fi能力。
- 支持CarPlay的iPhone，以及能被iPhone接受的配件认证材料。
- 本机移动热点，或允许设备互访的共用Wi-Fi。

安装包内置Electron、Node.js和Windows平台桥接，普通用户无需安装开发工具。当前提供本地构建的`WinPlay-1.1.0-Setup-x64.exe`，生成方法见[从源码构建](#从源码构建)。

### 安装与连接

1. 运行EXE安装向导，安装后打开WinPlay。当前安装包尚未做发行代码签名。
2. 在Windows蓝牙设置中配对iPhone，再回到“连接”页刷新并选择设备。
3. 选择“本机移动热点”或“现有局域网”，填写SSID、共享密码和实际信道，确认自动推荐的网卡。
4. 点击“启动接收”，在iPhone上允许CarPlay。独立画面窗口立即打开，等待视频时显示黑色。
5. 修改连接、显示或音频设备设置后，点击“应用并重新连接”。

| 无线模式 | 如何准备网络 | 接口选择 |
| --- | --- | --- |
| 本机移动热点 | 在Windows设置中开启热点，让iPhone加入 | 活动热点共享接口或Wi-FiDirect虚拟接口 |
| 现有局域网 | Windows与iPhone加入同一Wi-Fi，填写路由器共享密码 | 对应物理网络接口，可填写路由器BSSID |

两种模式分别保存配置，应用自动推荐网卡并保留有效的同模式手动选择。热点未开启时需先开启再刷新；局域网模式可读取当前SSID、信道和Windows保存的共享密码。企业认证、网页登录或客户端隔离可能阻止连接，防火墙需允许两端互访与Bonjour多播。

完整操作见[使用教程](docs/使用教程.md)。停止接收不会关闭Windows移动热点。

## 主要功能

- 四页设置：连接、显示、音频和诊断，左侧导航与圆角卡片，支持浅色、深色和跟随Windows外观。
- 无线双模式：本机移动热点或现有局域网，独立保存配置并自动推荐对应网卡。
- 独立画面：按真实物理像素创建固定窗口，支持显示器选择、自定义分辨率和全屏窗口化。
- 鼠标与触控板：点击、拖动及上下/左右滚动转换为CarPlay触摸输入。
- 音频与媒体：实时媒体/通话音量、输入/输出设备选择，以及Windows系统媒体控件同步与操作。
- 断开复位：主动停止或会话断开后关闭CarPlay窗口，主界面恢复“启动接收”。

## 其他平台

使用Windows电脑时选择WinPlay；需要Mac上的USB直连，或希望使用Android手机、平板和车机时，可以选择下面的项目。

| 项目 | 平台 | 适合的使用场景 |
| --- | --- | --- |
| [MacPlay](https://github.com/Roylyl/MacPlay) | macOS14及以上 | 适合Mac用户。支持USB直连和共用Wi-Fi无线连接，提供原生设置界面、多屏显示与系统媒体控件。 |
| [AndroidPlay](https://github.com/Roylyl/AndroidPlay) | Android9及以上 | 适合Android手机、平板和车机。通过系统热点与蓝牙连接iPhone，提供全屏画面、音频和通知栏媒体控制。 |

## 显示与操作

首次安装默认1280×720、60fps。分辨率可选屏幕原生像素、1280×720、1920×1080、2560×1440和自定义；“请求像素”随选择更新，应用后才重新协商。

普通CarPlay窗口可以移动，不能拖动调整大小；画面区域按物理像素设置，Windows缩放不会放大窗口，视频保持比例并在剩余区域留黑边。原生像素或屏幕最大分辨率采用全屏窗口化，Esc与Win+D可隐藏画面到系统托盘，通过托盘菜单恢复。超出所选屏幕可用区域时明确报错。

帧率可选30/60/90/120fps。120启动失败后尝试90，再失败尝试60；请求帧率、本次尝试、实际收到和实际解码帧率分别显示，屏幕刷新率不作为视频帧率。高帧率是请求上限，实际输出由iPhone、网络和解码能力决定。

首次关闭主窗口时可选择退出或最小化到托盘，并勾选“不再提示”；之后可在“显示→窗口行为”修改。点击托盘图标恢复主窗口，右键菜单可显示CarPlay画面或退出应用。最小化保持连接，退出会停止接收。

关闭CarPlay画面窗口时，会询问是否断开与iPhone的连接；取消后保持连接，确认后停止接收。iPhone主动断开时，画面窗口自动关闭。

## 音频与系统媒体控件

媒体音量、通话音量和播放开关实时生效。输入/输出默认跟随系统，也可分别选择；切换设备后需应用并重新连接，麦克风访问需要Windows权限。

通过Windows原生系统媒体控件同步iPhone上报的播放状态、标题、歌手、专辑、封面与进度，回传播放/暂停、切歌和播放器允许的进度跳转。标题字段中的歌词不作为切歌，只在曲目身份变化或收到关联封面更新时更换图片。音乐App没有上报的信息可能为空。

音乐使用48kHz立体声AAC传输，实际编码码率由iPhone决定。音频页显示实际协商格式；不提供PCM音乐模式或AAC目标码率设置。

## 认证与数据

本地安装包使用构建者提供的`identity.pk8`与`certificate.p7b`。诊断页可以导入替换，本机导入文件优先。格式和公钥需匹配，最终认证由iPhone决定；公开分发前应确认认证材料授权，或移除内置文件并要求用户导入，见[NOTICE](NOTICE)。

配置、导入认证文件与CarPlay配对身份保存在`%APPDATA%\WinPlay\data`，敏感数据使用WindowsDPAPI保护。诊断导出不包含Wi-Fi密码、手机地址或配对密钥；卸载保留用户数据。

## 常见问题

| 现象 | 处理方法 |
| --- | --- |
| 热点模式没有推荐网卡 | 先开启Windows移动热点，再刷新网络接口 |
| 蓝牙列表没有iPhone | 在Windows系统设置中完成配对后刷新设备列表 |
| 画面窗口打开后仍为黑色 | 查看连接状态，检查认证、网络接口、SSID、密码和防火墙 |
| 自定义窗口无法启动 | 调整为能放入所选屏幕的分辨率，或选择原生像素模式 |
| 媒体进度不能拖动 | 播放器需上报有效时长并允许跳转 |

## 从源码构建

在Windows项目根目录使用Node.js24与npm，Windows自带.NETFramework的C#编译器用于平台桥接。首次下载依赖、运行时和.NETFramework编译参考程序集需要联网：

~~~powershell
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fetch-runtime.ps1
npm run build
npm start
~~~

打包前在`resources/authentication`放入有权使用的认证文件，然后执行：

~~~powershell
npm run dist
~~~

生成`dist/WinPlay-1.1.0-Setup-x64.exe`，成功后复制到Windows桌面。当前交付脚本随后通过官方卸载程序清理已有WinPlay安装，保留用户数据；不生成源码ZIP。

`src/engine`负责无线引导与网络协议，`src/ui`负责设置、画面和音频，`native/Platform.cs`负责Windows蓝牙、窗口物理像素及数据保护，`native/MediaBridge.cs`负责Windows系统媒体控件。认证文件、运行时、依赖缓存和构建产物已由.gitignore排除。

## 来源与许可

无线引导参考[AndroidPlay](https://github.com/Roylyl/AndroidPlay)，局域网方案和网络协议复用[MacPlay](https://github.com/Roylyl/MacPlay)，保留LIVI、LasseHeitgres及贡献者和DiPlay来源声明。项目沿用GPL-3.0-or-later，见[LICENSE](LICENSE)、[NOTICE](NOTICE)和[第三方声明](vendor/THIRD-PARTY-NOTICES.txt)。

WinPlay是独立衍生项目，不代表Apple或上游作者，不声称获得MFi认证。第三方组件、认证证书、私钥和商标继续适用各自权利条件。
