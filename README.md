<p align="center"><img src="resources/icons/winplay-256.png" width="104" alt="WinPlay应用图标"></p>

<h1 align="center">WinPlay</h1>

<p align="center">在Windows上使用iPhone的CarPlay，支持USB直连、无线连接、独立画面窗口与鼠标/触控板操作。</p>

<p align="center">
  <a href="package.json"><img src="https://img.shields.io/badge/source-1.3.0-2563eb?style=flat-square" alt="源码版本1.3.0"></a>
  <a href="https://github.com/Roylyl/WinPlay/releases/latest"><img src="https://img.shields.io/github/v/release/Roylyl/WinPlay?style=flat-square&amp;label=release&amp;color=2563eb" alt="GitHub最新正式发行版"></a>
  <a href="#使用条件"><img src="https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-555555?style=flat-square" alt="Windows10/11x64"></a>
  <a href="#有线连接"><img src="https://img.shields.io/badge/CarPlay-USB-2563eb?style=flat-square" alt="有线CarPlay"></a>
  <a href="#无线连接"><img src="https://img.shields.io/badge/CarPlay-wireless-2563eb?style=flat-square" alt="无线CarPlay"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-2563eb?style=flat-square" alt="GPL-3.0-or-later许可证"></a>
  <a href="https://github.com/Roylyl/WinPlay/releases"><img src="https://img.shields.io/badge/download-x64%20EXE-2563eb?style=flat-square" alt="Windows安装包发行页"></a>
</p>

<p align="center">
  <a href="#界面与语言"><img src="https://img.shields.io/badge/languages-%E7%AE%80%E4%BD%93%20%2F%20%E7%B9%81%E9%AB%94%20%2F%20English-555555?style=flat-square" alt="简体中文、繁體中文和English"></a>
  <a href="#从源码构建"><img src="https://img.shields.io/badge/core-Electron%2042-555555?style=flat-square" alt="Electron42桌面应用"></a>
  <a href="https://github.com/Roylyl/WinPlay/releases"><img src="https://img.shields.io/github/downloads/Roylyl/WinPlay/total?style=flat-square&amp;label=downloads&amp;color=2563eb" alt="发行附件累计下载量"></a>
  <a href="https://github.com/Roylyl/WinPlay/stargazers"><img src="https://img.shields.io/github/stars/Roylyl/WinPlay?style=flat-square&amp;label=stars&amp;color=2563eb" alt="GitHubStar数"></a>
  <a href="https://github.com/Roylyl/WinPlay/forks"><img src="https://img.shields.io/github/forks/Roylyl/WinPlay?style=flat-square&amp;label=forks&amp;color=555555" alt="GitHubFork数"></a>
  <a href="https://github.com/Roylyl/WinPlay/issues"><img src="https://img.shields.io/github/issues/Roylyl/WinPlay?style=flat-square&amp;label=issues&amp;color=555555" alt="开放Issue数"></a>
  <a href="https://github.com/Roylyl/WinPlay/pulls"><img src="https://img.shields.io/github/issues-pr/Roylyl/WinPlay?style=flat-square&amp;label=pull%20requests&amp;color=555555" alt="开放PullRequest数"></a>
  <a href="https://github.com/Roylyl/WinPlay/commits"><img src="https://img.shields.io/github/last-commit/Roylyl/WinPlay?style=flat-square&amp;label=last%20commit&amp;color=555555" alt="最近提交时间"></a>
</p>

<p align="center"><a href="#快速入门">快速入门</a> · <a href="#主要功能">主要功能</a> · <a href="#显示与窗口">显示与窗口</a> · <a href="#音频与媒体控件">音频与媒体</a> · <a href="#其他平台">其他平台</a> · <a href="#从源码构建">源码构建</a> · <a href="docs/RELEASE-1.3.0.md">1.3.0版本说明</a> · <a href="#捐赠">捐赠</a></p>

<p align="center">其他平台：<a href="https://github.com/Roylyl/MacPlay">macOS</a> · <a href="https://github.com/Roylyl/LinuxPlay">Linux</a> · <a href="https://github.com/Roylyl/AndroidPlay">Android</a></p>

<p align="center"><a href="https://github.com/Roylyl/WinPlay/releases/latest">下载安装包</a> · <a href="#快速入门">使用方法</a> · <a href="https://github.com/Roylyl/WinPlay/issues">反馈问题</a></p>

WinPlay接续[MacPlay](https://github.com/Roylyl/MacPlay)，让Windows电脑接收iPhone的CarPlay画面和声音。导航、音乐与支持CarPlay的应用在独立窗口中运行，设置集中在主窗口。

## 快速入门

### 使用条件

| 连接方式 | 电脑要求 | iPhone连接方式 |
| --- | --- | --- |
| 有线CarPlay | Windows11x64、Apple设备应用或兼容的Apple设备驱动、USB数据线 | 通过USB连接并解锁，首次连接时确认信任 |
| 本机移动热点 | Windows10/11x64、蓝牙适配器、支持移动热点的Wi-Fi网卡 | 与电脑配对蓝牙并接入Windows移动热点 |
| 现有局域网 | Windows10/11x64、蓝牙适配器，电脑可通过Wi-Fi或网线接入路由器 | 与电脑配对蓝牙并接入同一路由器的Wi-Fi |

### 安装

1. 从[GitHub发行页](https://github.com/Roylyl/WinPlay/releases/latest)下载安装包。1.3.0的文件名为`WinPlay-1.3.0-Setup-x64.exe`，单个EXE内置运行组件，可离线安装。
2. 打开WinPlay，在“关于→认证文件”确认材料已就绪。需要导入时，一次选中匹配且有权使用的`identity.pk8`与`certificate.p7b`。
3. 在“连接”页选择有线或无线，按对应步骤启动接收。解码出首帧后，CarPlay会在独立窗口中显示。

升级前退出旧版，再运行新版安装包。升级保留设置、认证文件与配对数据。

### 有线连接

1. 选择“有线CarPlay”，用USB数据线连接iPhone，解锁并在首次连接时确认信任。
2. 在“USB设备”下拉列表中保留“自动（上次连接的iPhone）”，或按设备名称和标识末尾5位手动选择。自动模式优先使用已连接且上次成功显示过画面的iPhone；只接入一台时可直接选用。同时接入多台且没有匹配记录时，请手动选择。
3. “USB接入时自动启动CarPlay”默认开启，也可点击“启动接收”。Windows需要准备USB网卡时会提示管理员确认。有线模式通过USB传输音视频，无需蓝牙配对或Wi-Fi配置。

### 无线连接

1. 选择“无线CarPlay”，在Windows蓝牙设置中完成配对，再回WinPlay刷新并选择iPhone。
2. 选“本机移动热点”或“现有局域网”，保持网卡为“自动选择（推荐）”，点击“读取当前网络和密码”。
3. 热点模式读取Windows移动热点设置中的网络名称和密码，信道0表示自动。局域网模式下，电脑通过Wi-Fi连接时可读取当前SSID、信道和可用的已保存密码。电脑通过网线连接时，请填写iPhone所用Wi-Fi的名称、密码和实际信道，按提示让iPhone接入该Wi-Fi。
4. 点击“启动接收”，在iPhone上确认允许CarPlay。修改连接、显示或音频设备后，点击“应用并重新连接”。

局域网两端需要可互访。Wi-Fi共享密码需为8—63位，访客网络隔离、企业认证或网页登录可能阻止连接。需要指定接口时可展开“手动选择网卡（高级）”。

## 主要功能

| 功能 | 说明 |
| --- | --- |
| 有线与无线 | USB直连、Windows移动热点和现有局域网；两种无线模式分别保存配置 |
| 画面与输入 | 独立CarPlay窗口，支持鼠标点击、拖动及触控板、滚轮的上下左右滚动 |
| 显示 | 可选显示器、分辨率、最高帧率，普通窗口可等比例缩放 |
| 音频与媒体 | 分别调节媒体与通话音量，选择音频设备，并在Windows系统媒体控件同步播放信息 |
| 无线自动重连 | 已连接的会话意外断开后可自动回连，默认关闭 |
| 界面与更新 | 简体中文、繁體中文与English，外观可跟随Windows，可检查更新和导出诊断 |

### 界面与语言

主窗口按连接、显示、音频、关于和捐赠组织设置。“连接→应用”可调整语言、外观和关闭主窗口时的行为。WinPlay的外观设置仅应用在主界面，CarPlay画面外观由iPhone控制。

## 显示与窗口

- 首次启动默认请求1280×720、最高60fps。可选屏幕原生像素、1280×720、1920×1080、2560×1440或自定义。修改设置时，“请求像素”立即更新，应用后重新协商。
- 普通窗口按屏幕可用空间居中适配。拖动标题栏只移动窗口，拖动边框时连续等比例缩放，视频保持原始比例。窗口大小和向iPhone请求的分辨率可分别调整。
- “严格按屏幕物理像素显示”默认关闭。成功读取所选显示器的真实像素尺寸后才可开启，开启后画面固定为请求的物理像素尺寸。选择“屏幕原生像素”时以全屏窗口显示。读取失败时仍可使用普通窗口。
- 最高帧率可选30/60/90/120fps，实际帧率取决于iPhone和画面内容。高帧率启动失败时按120→90→60fps尝试，可在“显示→流畅度”查看接收和解码统计。
- 两个窗口点击“－”均最小化到任务栏，CarPlay窗口也可按Esc最小化。关闭CarPlay窗口会询问是否断开；关闭主窗口可选择退出或留在托盘。
- “无线连接被动断开时自动重连”开启后，依次等待5、10、20、30、60秒回连，此后每60秒尝试。主动停止、确认断开或退出会取消重试。

## 音频与媒体控件

媒体和通话音量、播放开关实时生效，切换输入或输出设备后应用并重新连接。音频页显示实际协商格式，麦克风使用需Windows授权。

Windows系统媒体控件可显示iPhone上报的歌名、歌手、专辑、封面和进度，并控制播放、暂停、切歌及播放器支持的进度跳转。用歌名或专辑字段发送的歌词照常同步，重复封面独立去重。同一首歌内连续变化的封面最多每5秒更新一次，切歌后首张新封面立即显示。

## 更新、诊断与本机数据

- “关于→软件更新”默认在每次启动后检查，运行期间每两小时后台检查一次。更新按正式发行的数字版本号比较，支持`V1.3.0`一类标签，也可手动检查。
- “关于→日志”可打开或导出诊断。遇到问题时，请注明WinPlay版本、连接方式、出现时间和复现步骤；声音问题可补充实际使用的输出设备。提交前请检查附件内容。 [反馈问题](https://github.com/Roylyl/WinPlay/issues)
- 设置、认证材料和配对数据位于`%APPDATA%\WinPlay\data`，敏感数据由WindowsDPAPI保护。卸载默认保留数据。认证文件与程序源码适用各自的授权条件。 [认证与分发声明](NOTICE)

| 常见问题 | 处理方法 |
| --- | --- |
| USB列表没有iPhone | 检查USB线是否支持数据传输，解锁iPhone并确认信任，再刷新USB设备；在Apple设备应用中确认手机可见 |
| 同时接入多台iPhone | 从USB设备下拉列表手动指定一台，使用标识末尾5位区分同名设备 |
| 无线连接超时 | 确认iPhone加入指定Wi-Fi、两端可互访，并检查Windows防火墙和实际选中的网卡 |
| 严格物理像素不可用 | 先使用普通模式，或在“显示位置”旁刷新，检测成功后开启 |
| 启动后未显示画面 | 查看接收状态，确认认证文件和连接方式；仍无法连接时导出诊断 |

## 其他平台

| 项目 | 适用平台与用途 |
| --- | --- |
| [MacPlay](https://github.com/Roylyl/MacPlay) | macOS上的CarPlay接收端，支持USB直连和共用局域网无线连接 |
| [AndroidPlay](https://github.com/Roylyl/AndroidPlay) | Android上的无线CarPlay接收端，使用系统热点配合蓝牙连接 |
| [LinuxPlay](https://github.com/Roylyl/LinuxPlay) | Linux桌面上的无线CarPlay接收端，支持本机热点和现有局域网 |

## 从源码构建

在Windows项目根目录使用Node.js24与npm。需要Visual Studio Build Tools的MSVC x64与Windows SDK，以及Windows自带的.NETFramework C#编译器。

~~~powershell
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fetch-runtime.ps1
npm run build
npm start
~~~

打包时执行`npm run dist`。如需随安装包提供配套认证材料，将有权使用的文件放入`resources/authentication`。安装包生成在`dist`，项目的[导出脚本](scripts/export-installer.ps1)会将其复制到桌面，再卸载本机已有的WinPlay并保留用户数据。

只修改README或发行说明时，可以直接发布文档。源码目录按实现分为`src/engine`、`src/wired`、`src/ui`及`native`。 [1.3.0版本说明](docs/RELEASE-1.3.0.md)

## 来源与许可

无线引导参考[AndroidPlay](https://github.com/Roylyl/AndroidPlay)，局域网方案与网络协议复用[MacPlay](https://github.com/Roylyl/MacPlay)，保留[LIVI](https://github.com/f-io/LIVI)、LasseHeitgres及贡献者和[DiPlay](https://github.com/shihabal3amri/DiPlay)来源声明。项目沿用GPL-3.0-or-later，见[LICENSE](LICENSE)、[NOTICE](NOTICE)与[第三方声明](vendor/THIRD-PARTY-NOTICES.txt)。

Windows有线连接参考[WinXPlay](https://github.com/Peterinor/WinXPlay)的Apple兼容接口和CDC分组，以及[RustCarPlay](https://github.com/Ezreal-byte/RustCarPlay)的USB配置与会话启动顺序。

WinPlay是独立衍生项目，不代表Apple或上游作者，不声称获得MFi认证。第三方组件、认证证书、私钥和商标继续适用各自权利条件。分发修改版时应保留声明，并提供适用许可要求的对应源码与构建资料。

## 捐赠

如果WinPlay对你有帮助，欢迎支持项目的持续维护。应用侧栏的“捐赠”页也提供以下方式，收款码可点击放大。

<table>
  <tr>
    <th>微信支付</th>
    <th>支付宝</th>
    <th>AlipayHK</th>
  </tr>
  <tr>
    <td align="center"><a href="src/ui/donation/wechat.jpg"><img src="src/ui/donation/wechat.jpg" width="200" alt="微信支付收款码"></a></td>
    <td align="center"><a href="src/ui/donation/alipay.jpg"><img src="src/ui/donation/alipay.jpg" width="200" alt="支付宝收款码"></a></td>
    <td align="center"><a href="src/ui/donation/alipayhk.jpg"><img src="src/ui/donation/alipayhk.jpg" width="200" alt="AlipayHK收款码"></a></td>
  </tr>
</table>

<a href="https://paypal.me/RoyRoylyl"><img src="https://img.shields.io/badge/PayPal-RoyRoylyl-0070ba?style=flat-square" alt="通过PayPal捐赠"></a>
