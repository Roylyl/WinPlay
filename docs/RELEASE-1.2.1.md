# WinPlay1.2.1

WinPlay让Windows电脑成为无线CarPlay接收端，支持本机移动热点与现有局域网连接，提供独立画面窗口、音频播放和鼠标/触控板操作。

1.2.1修复统一发行标签后的更新识别问题，继续保留1.2.0的功能与音视频优化。

## 更新内容

- 兼容统一的`V1.2.1`、`v1.2.1`标签，同时保留旧的`WinPlay-1.2.1`及纯数字版本标签支持。
- 更新按主版本、次版本和修订版本逐项比较，不按发布时间判断；草稿和预发行版不参与正式更新。
- 发行说明与安装包下载地址使用GitHub发行记录的实际标签，修复改名后无法识别安装附件的问题。
- 缓存保留实际标签，应用重启后仍使用对应发行页和下载地址，兼容旧版更新缓存。
- 保留安装包来源与名称检查，匹配Roylyl/WinPlay仓库下对应版本的x64EXE。
- 程序、设置界面与向iPhone上报的配件版本统一更新为1.2.1。

自动检查默认开启，两次自动检查至少间隔24小时；手动检查不受该间隔限制。下载通过系统浏览器完成，安装由用户执行。

## 下载与升级

在[GitHubReleases](https://github.com/Roylyl/WinPlay/releases)查看已发布版本与附件，下载`WinPlay-1.2.1-Setup-x64.exe`。

- 适用于Windows10/11x64，电脑需具备蓝牙与Wi-Fi能力。
- 单个离线EXE内置运行组件，无需另外安装Node.js或Electron。
- 升级前退出旧版，运行新安装包；已有设置、导入认证文件和配对数据保留。
- 当前安装包未做发行代码签名，Windows可能显示安全提示。

旧版1.2.0的更新模块只识别`WinPlay-`标签。若发行标签已经改为`V`格式，旧版可能无法自动发现本次更新，请从发行页手动下载安装1.2.1；安装后即可识别后续统一标签的正式版本。

首次安装默认1280×720、60fps。连接方式和认证前提见[README](https://github.com/Roylyl/WinPlay#readme)，1.2.0功能介绍见[1.2.0发行说明](https://github.com/Roylyl/WinPlay/blob/main/docs/RELEASE-1.2.0.md)。

## 项目主页

- [WinPlay](https://github.com/Roylyl/WinPlay)：Windows无线CarPlay接收端。
- [MacPlay](https://github.com/Roylyl/MacPlay)：macOSCarPlay接收端，支持USB直连与共用Wi-Fi无线连接。
- [AndroidPlay](https://github.com/Roylyl/AndroidPlay)：Android手机、平板与车机的无线CarPlay接收端。

问题反馈见[Issues](https://github.com/Roylyl/WinPlay/issues)。项目遵循GPL-3.0-or-later并保留上游声明，见[LICENSE](https://github.com/Roylyl/WinPlay/blob/main/LICENSE)与[NOTICE](https://github.com/Roylyl/WinPlay/blob/main/NOTICE)。认证材料与商标分别适用各自权利条件，代码许可不代表获得认证材料的再分发授权。
