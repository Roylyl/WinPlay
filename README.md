<p align="center"><img src="resources/icons/winplay-256.png" width="104" alt="WinPlay应用图标"></p>

<h1 align="center">WinPlay</h1>

<p align="center">把iPhone的CarPlay带到Windows，支持无线连接、独立画面窗口、音频播放与鼠标/触控板操作。</p>

<p align="center">
  <a href="package.json"><img src="https://img.shields.io/badge/source-1.2.1-2563eb?style=flat-square" alt="源码版本1.2.1"></a>
  <a href="https://github.com/Roylyl/WinPlay/releases/latest"><img src="https://img.shields.io/github/v/release/Roylyl/WinPlay?style=flat-square&amp;label=release&amp;color=2563eb" alt="GitHub最新正式发行版"></a>
  <a href="#使用条件"><img src="https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-555555?style=flat-square" alt="Windows10/11x64"></a>
  <a href="#无线连接"><img src="https://img.shields.io/badge/CarPlay-wireless-2563eb?style=flat-square" alt="无线CarPlay"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-2563eb?style=flat-square" alt="GPL-3.0-or-later许可证"></a>
  <a href="https://github.com/Roylyl/WinPlay/releases"><img src="https://img.shields.io/badge/download-x64%20EXE-2563eb?style=flat-square" alt="Windows安装包发行页"></a>
</p>

<p align="center">
  <a href="#界面与语言"><img src="https://img.shields.io/badge/languages-%E7%AE%80%E4%BD%93%20%2F%20%E7%B9%81%E9%AB%94%20%2F%20English-555555?style=flat-square" alt="简体中文、繁體中文和English"></a>
  <a href="#从源码构建"><img src="https://img.shields.io/badge/core-Electron%2040-555555?style=flat-square" alt="Electron40桌面应用"></a>
  <a href="https://github.com/Roylyl/WinPlay/releases"><img src="https://img.shields.io/github/downloads/Roylyl/WinPlay/total?style=flat-square&amp;label=downloads&amp;color=2563eb" alt="发行附件累计下载量"></a>
  <a href="https://github.com/Roylyl/WinPlay/stargazers"><img src="https://img.shields.io/github/stars/Roylyl/WinPlay?style=flat-square&amp;label=stars&amp;color=2563eb" alt="GitHubStar数"></a>
  <a href="https://github.com/Roylyl/WinPlay/forks"><img src="https://img.shields.io/github/forks/Roylyl/WinPlay?style=flat-square&amp;label=forks&amp;color=555555" alt="GitHubFork数"></a>
  <a href="https://github.com/Roylyl/WinPlay/issues"><img src="https://img.shields.io/github/issues/Roylyl/WinPlay?style=flat-square&amp;label=issues&amp;color=555555" alt="开放Issue数"></a>
  <a href="https://github.com/Roylyl/WinPlay/pulls"><img src="https://img.shields.io/github/issues-pr/Roylyl/WinPlay?style=flat-square&amp;label=pull%20requests&amp;color=555555" alt="开放PullRequest数"></a>
  <a href="https://github.com/Roylyl/WinPlay/commits"><img src="https://img.shields.io/github/last-commit/Roylyl/WinPlay?style=flat-square&amp;label=last%20commit&amp;color=555555" alt="最近提交时间"></a>
</p>

<p align="center"><a href="#快速入门">快速入门</a> · <a href="#主要功能">主要功能</a> · <a href="#显示与窗口">显示与窗口</a> · <a href="#音频与媒体控件">音频与媒体</a> · <a href="#其他平台">其他平台</a> · <a href="#从源码构建">源码构建</a> · <a href="docs/RELEASE-1.2.1.md">1.2.1发行说明</a></p>

<p align="center">其他设备：<a href="https://github.com/Roylyl/MacPlay">MacPlay</a> · <a href="https://github.com/Roylyl/AndroidPlay">AndroidPlay</a></p>

WinPlay接续[MacPlay](https://github.com/Roylyl/MacPlay)，把独立CarPlay窗口与分组设置带到Windows，并参考[AndroidPlay](https://github.com/Roylyl/AndroidPlay)的热点连接方案。适合Windows笔记本、平板与桌面电脑，使用Windows移动热点或现有局域网接收iPhone的CarPlay，在电脑上操作导航、播放音乐和使用CarPlay应用。

蓝牙负责配对与连接引导，Wi-Fi传输音视频。两种无线模式分别保存配置，手机端的配件名称与车型统一为WinPlay。

## 快速入门

### 使用条件

- Windows10/11x64，具备蓝牙与Wi-Fi能力。
- 支持CarPlay的iPhone，开启Wi-Fi与蓝牙，并允许CarPlay连接。
- 可用的Windows移动热点，或允许两端互访的共用Wi-Fi。
- 能被iPhone接受、且有权使用的配套认证材料，见[认证与本机数据](#认证与本机数据)。

安装包内置Electron、Node.js与Windows平台桥接，普通用户无需额外安装Node.js或开发工具。

### 安装

在[GitHubReleases](https://github.com/Roylyl/WinPlay/releases)选择发行版并下载x64EXE。安装包内置运行组件，可离线安装。当前源码版本为1.2.1，对应构建文件名为`WinPlay-1.2.1-Setup-x64.exe`；可下载版本以发行页为准，也可[从源码构建](#从源码构建)。

运行安装包，按向导完成安装并打开WinPlay。当前安装包尚未做发行代码签名。首次默认1280×720、60fps、系统默认输入/输出设备、100%音量与跟随系统语言。

在“关于→认证文件”确认文件已就绪。需要替换时，一次选中匹配的`identity.pk8`和`certificate.p7b`导入，本机导入的配套文件优先使用。

### 无线连接

1. 在Windows蓝牙设置中配对iPhone，回到WinPlay点击“刷新iPhone列表”并选择目标。
2. 选择本机移动热点或现有局域网，按下表准备网络。
3. 点击“读取当前网络和密码”自动填入配置，读取失败的部分可手动填写。网络接口默认“自动检测”，也可手动选择。
4. 点击“启动接收”，在iPhone上确认允许CarPlay。收到视频并完成首帧解码后，独立画面窗口自动显示。
5. 修改连接、显示或音频设备后，点击“应用并重新连接”。

| 无线模式 | 网络准备 | 接口检测 |
| --- | --- | --- |
| 本机移动热点 | 在Windows设置中开启移动热点；读取系统设置中的热点名称和密码，信道0表示自动发现 | 识别Windows实际用于热点共享的私有接口，等待链路与地址就绪 |
| 现有局域网 | Windows与iPhone加入同一Wi-Fi；读取当前网络、实际信道和对应的已保存密码 | 选择已连接的物理网络接口，可按需填写接入点BSSID |

两个模式共用“读取当前网络和密码”按钮，但各自读取对应配置。热点模式读取Windows移动热点设置；局域网模式读取当前Wi-Fi及同一网卡上对应配置的密码。不能读取的字段会显示原因并保留原输入，仍可手动填写。启动热点接收时会再次读取系统配置，减少名称、密码变更后仍沿用旧参数的情况。

Wi-Fi共享密码需为8—63位，企业802.1X、网页登录与访客网络的客户端隔离可能阻止连接。防火墙需允许WinPlay与iPhone互访以及Bonjour多播。停止接收不会关闭Windows移动热点。

## 主要功能

| 功能 | 使用体验 |
| --- | --- |
| 无线双模式 | 本机移动热点与现有局域网分别保存配置，按所选模式自动检测网卡 |
| 独立画面窗口 | 默认1280×720、60fps，按屏幕物理像素显示，保持视频比例 |
| 多屏与分辨率 | 选择显示器、预设或自定义像素，支持屏幕原生像素的全屏窗口化 |
| 鼠标与触控板 | 点击、拖动，以及上下/左右连续滚动 |
| 音量与设备 | 媒体与通话音量实时调节，输入/输出设备默认跟随系统 |
| Windows媒体控件 | 同步播放信息，回传播放/暂停、切歌与播放器允许的进度跳转 |
| 歌词与封面 | 标题字段中的歌词照常同步，封面独立去重并按需更新 |
| 窗口与托盘 | 正常最小化到任务栏，可选择关闭主窗口后留在托盘继续接收 |
| 多语言 | 跟随系统、简体中文、繁體中文、English，切换立即生效 |
| 关于与更新 | 查看版本、检查正式发行版、下载对应安装包，并管理日志与认证 |

### 界面与语言

主窗口分为连接、显示、音频和关于四页，采用与MacPlay对应的左侧导航和右侧分组卡片。CarPlay画面单独显示，设置不会叠加在画面上。

连接、显示、音频页保留固定底部接收栏。接收未启动时显示“启动接收”；运行期间提供“停止接收”“显示画面”和“应用并重新连接”。关于页集中展示版本、更新、日志与认证，最近日志和认证区默认折叠。

“连接→应用”提供语言、关闭行为与外观设置。支持浅色、深色及跟随Windows；外观只影响WinPlay自身界面，CarPlay语言和画面外观由iPhone决定。切换设置页或应用语言不会断开会话。

## 显示与窗口

### 分辨率与帧率

“显示→视频分辨率”提供屏幕原生像素、1280×720、1920×1080、2560×1440和自定义。选择自定义后显示宽高输入，“请求像素”随输入更新，在点击应用前不重新协商。

普通CarPlay窗口可以拖动标题栏移动，禁止通过边框调整大小。画面区域按所选屏幕的真实物理像素设置，Windows缩放不会放大一个1280×720的画面。视频保持比例，剩余区域留黑边；原生像素或屏幕最大分辨率采用全屏窗口化。

尺寸超出所选屏幕时会在分辨率卡片提示错误，保留输入供修改，不静默缩小，也不会使用旧尺寸继续启动。CarPlay自身的“智能缩放显示”可能改变界面内容大小，可在iPhone上调整。

帧率可选30/60/90/120fps，默认60fps。120的视频启动失败后尝试90，再失败尝试60；高帧率是请求上限，实际输出取决于iPhone、网络与解码能力。在“显示→流畅度→接收统计”可分别查看请求、本次尝试、实际接收和解码帧率，屏幕刷新率不作为视频帧率。

### 最小化与断开

主窗口和CarPlay窗口点击“－”均正常最小化到Windows任务栏，保留图标与连接。CarPlay窗口按Esc也最小化到任务栏，Win+D遵循Windows显示桌面的行为；通过任务栏图标、“显示画面”或托盘菜单重新唤起。

首次关闭主窗口时可选择退出或最小化到托盘，并勾选“不再提示”；之后可在“连接→应用”修改。托盘菜单可显示主窗口、显示CarPlay、启动/停止接收或退出应用。

关闭CarPlay窗口会先询问“您确定要断开与iPhone的连接吗？”取消保持连接，确认后停止接收。主动停止或完整会话断开后，画面窗口自动关闭，主界面恢复“启动接收”，保留当前页面与配置。CarPlay内部的WinPlay入口用于打开设置主窗口。

## 音频与媒体控件

### 声音与设备

媒体音量、通话音量和播放开关实时生效。输入与输出设备默认跟随系统，也可分别选择；切换设备后点击“应用并重新连接”。麦克风使用需要Windows授权，拒绝后仍可接收画面与播放声音。

音乐支持48kHz双声道AAC传输，音频页显示实际协商格式，码率由iPhone决定。音频包先按协商延迟缓冲与重排，解码后按手机原始采样时间播放，并直接输出到所选Windows设备。音乐起播可能短暂等待，导航和通话使用较短缓冲；迟到音频不会通过加速播放追赶。

视频接收与音频播放分别管理：视频积压时暂停读取压缩帧，保持完整参考链；绘制时只保留最新的已解码画面，减少快速滑动产生的绘制积压。音频缺包保留对应时间间隔，后续音频继续按原时钟播放。

### 系统媒体控件

WinPlay向Windows系统媒体控件同步iPhone上报的播放状态、标题、歌手、专辑、封面、时长与进度。系统按钮可播放/暂停、上一首与下一首；播放器上报有效时长并允许跳转时，可拖动系统进度条。未上报的信息可能为空。

### 歌词与封面

部分音乐App通过歌名字段显示歌词，有时专辑文字也会频繁变化。WinPlay照常同步这些文字，不把标题或专辑文字变化当作切歌，封面独立按需处理：

- 确认切歌后清除旧封面，新曲目的首张封面立即显示。
- 相同图片不重复同步，歌词更新不重复携带已有封面。
- 同一首歌内连续变化的封面最多每5秒更新一次，期间保留最新一张。

这些处理减少应用内部的数据复制、画面刷新与系统媒体控件更新；iPhone已经发出的封面数据仍需接收。

## 更新与日志

“关于→软件更新”提供自动检查、手动检查、发行说明与下载入口。自动检查默认开启，启动后在后台运行，每天最多自动检查一次；手动检查不受每日频率限制。

更新只读取[Roylyl/WinPlay正式发行版](https://github.com/Roylyl/WinPlay/releases)，按版本号比较并匹配x64EXE。发现新版后可选择下载、查看说明或稍后处理，同一版本不重复自动提醒。通过系统浏览器下载后，由用户运行安装包，不强制自动安装；没有匹配安装包时显示原因并提供发行说明入口。

“关于→日志”可打开或导出诊断记录，“最近日志”展开后支持选择与复制。日志在保存、打开和导出时过滤网络标识、个人路径、认证内容与配对密钥，不导出设置或认证文件。

## 认证与本机数据

本地安装包内置构建者提供的`identity.pk8`与`certificate.p7b`，用户也可在关于页导入有权使用的配套文件。文件格式与公钥需匹配，最终认证由iPhone决定，普通Apple开发者签名证书不能替代CarPlay配件认证。

认证材料与程序代码分别适用各自权利条件，公开下载不代表获得再分发授权。公开分发安装包前，应确认内置材料授权，或移除内置文件并提供用户导入方式，见[NOTICE](NOTICE)。

设置、认证文件与CarPlay配对身份保存在`%APPDATA%\WinPlay\data`，敏感数据使用WindowsDPAPI保护。卸载默认保留用户数据。不要公开此目录、Wi-Fi密码或认证私钥。

## 常见问题

| 现象 | 处理方法 |
| --- | --- |
| 热点模式未找到可用接口 | 先在Windows设置中开启热点，等待地址就绪后刷新；可保持自动检测 |
| 蓝牙列表没有iPhone | 在Windows系统设置中完成配对，再刷新iPhone列表 |
| 启动后没有画面窗口 | 窗口在首帧解码后显示；查看连接状态，核对认证、网络参数、实际接口与防火墙 |
| 已连接后画面黑屏或出现异常色块 | 查看视频恢复提示并尝试应用重连；源端压缩也可能影响渐变色阶，持续异常时导出日志 |
| 无法读取网络或保存的密码 | 查看对应按钮下方的实际错误，检查Windows权限，或手动填写 |
| 自定义分辨率无法保存 | 按提示修改宽高为所选屏幕范围内的偶数像素尺寸，或选择原生像素 |
| 系统媒体信息为空或进度无法拖动 | 音乐App需上报相应字段、有效时长与跳转能力；直播可能不提供 |
| 歌名不断变化，封面不变 | 音乐App可能正在通过歌名字段同步歌词，属于正常行为 |
| 同曲封面没有立即变化 | 连续封面变化会合并，最多每5秒更新；新曲目首张封面立即显示 |
| 音乐起播有短暂等待 | 正在建立协商的音乐缓冲，导航和通话使用较短缓冲 |
| 音频变速变调、断续或爆音 | 确认输出设备并应用重连；持续发生时导出日志反馈 |

反馈问题可前往[GitHubIssues](https://github.com/Roylyl/WinPlay/issues)。请说明版本、无线模式、现象和出现时间；音频异常再补充输出设备及连接方式，例如DP/HDMI显示器、有线耳机或蓝牙耳机。日志包含音频缺包与时钟统计、视频数据量和队列积压，便于区分网络与播放问题。附日志前请检查内容，不要上传密码或私钥。

## 其他平台

WinPlay、MacPlay与AndroidPlay是面向不同设备的同系列项目。想在Mac上使用USB直连，或把Android手机、平板、车机用作接收端，可以选择对应项目：

| 项目 | 平台 | 适合的使用场景 |
| --- | --- | --- |
| [WinPlay](https://github.com/Roylyl/WinPlay) | Windows10/11x64 | Windows笔记本、平板或桌面显示器，支持移动热点与现有局域网无线接收 |
| [MacPlay](https://github.com/Roylyl/MacPlay) | macOS14及以上 | Mac用户，支持USB直连与共用Wi-Fi无线连接，提供原生设置与系统媒体控件 |
| [AndroidPlay](https://github.com/Roylyl/AndroidPlay) | Android9及以上 | Android手机、平板与车机，通过系统热点和蓝牙连接，提供全屏画面与通知栏媒体控制 |

## 从源码构建

在Windows项目根目录使用Node.js24与npm，Windows自带.NETFramework的C#编译器负责平台桥接。首次获取依赖、运行时和.NETFramework编译参考程序集需要联网：

~~~powershell
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fetch-runtime.ps1
npm run build
npm start
~~~

打包前，将有权使用的配套认证文件放入`resources/authentication`，然后执行：

~~~powershell
npm run dist
~~~

产物为`dist/WinPlay-1.2.1-Setup-x64.exe`，交付脚本同时复制到Windows桌面。本仓库的本机交付脚本会通过官方卸载程序清理已有WinPlay安装并保留用户数据，详见[交付约定](AGENTS.md)。

| 目录 | 内容 |
| --- | --- |
| `src/engine` | 无线引导、CarPlay协议、配对与音视频接收 |
| `src/ui` | 分组设置、独立画面、音频输出与多语言 |
| `native` | Windows蓝牙、物理像素、数据保护与系统媒体控件 |
| `resources` | 图标、运行时与构建所需认证资源 |
| `scripts` | 编译、运行时获取与安装包构建 |

认证文件、个人配置、运行时缓存、依赖与构建产物由.gitignore排除。

## 1.2.1更新

修复统一发行标签的更新识别，兼容`V1.2.1`、`v1.2.1`及旧的`WinPlay-1.2.1`。更新按数字版本比较，发行说明和安装包地址使用实际标签，重启后继续保留正确链接。详见[1.2.1发行说明](docs/RELEASE-1.2.1.md)。

### 1.2.0

- 设置布局与MacPlay对应：连接、显示、音频、关于四页，应用偏好归入连接页，更新、日志与认证集中管理。
- 加入跟随系统、简体中文、繁體中文与English，界面、托盘和系统确认框同步切换。
- 提供正式发行版更新检查、每日后台检查与对应x64安装包下载入口。
- 完善本机热点与局域网接口检测，合并“读取当前网络和密码”，热点读取Windows热点配置，启动前刷新交接参数。
- 首帧解码后再显示画面，保留物理像素固定窗口、任务栏最小化与断开确认，统一手机端WinPlay标识。
- 修复AAC缺包后的时间戳错位，增加视频背压与最新画面绘制，完善解码停滞恢复和音视频诊断。
- 完善完整会话断开与窗口清理，日志保存与导出统一过滤敏感信息。

完整内容见[WinPlay1.2.0发行说明](docs/RELEASE-1.2.0.md)。

## 来源与许可

无线引导参考[AndroidPlay](https://github.com/Roylyl/AndroidPlay)，局域网方案与网络协议复用[MacPlay](https://github.com/Roylyl/MacPlay)，保留[LIVI](https://github.com/f-io/LIVI)、LasseHeitgres及贡献者和[DiPlay](https://github.com/shihabal3amri/DiPlay)来源声明。项目沿用GPL-3.0-or-later，见[LICENSE](LICENSE)、[NOTICE](NOTICE)与[第三方声明](vendor/THIRD-PARTY-NOTICES.txt)。

WinPlay是独立衍生项目，不代表Apple或上游作者，不声称获得MFi认证。第三方组件、认证证书、私钥和商标继续适用各自权利条件。分发修改版时应保留声明，并提供适用许可要求的对应源码与构建资料。
