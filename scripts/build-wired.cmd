@echo off
setlocal
if defined WINPLAY_VS_SETUP (
    call "%WINPLAY_VS_SETUP%" -host_arch=x64 -arch=x64 -no_logo
    if errorlevel 1 exit /b 1
)
for %%I in ("%~dp0..\native\usb") do set "sourceDir=%%~fI"
for %%I in ("%~dp0..\build\native") do set "outputDir=%%~fI"
set "opts=/nologo /EHsc /W4 /O2 /MT /std:c++17 /D_WIN32_WINNT=0x0A00"
cl %opts% /Fo"%outputDir%\read-configurations.obj" /Fe"%outputDir%\UsbReadConfigurations.exe" "%sourceDir%\read-configurations.cpp"
if errorlevel 1 exit /b 1
cl %opts% /Fo"%outputDir%\apple-mode.obj" /Fe"%outputDir%\AppleUsbMode.exe" "%sourceDir%\apple-mode.cpp"
if errorlevel 1 exit /b 1
cl %opts% /Fo"%outputDir%\carkit-bridge.obj" /Fe"%outputDir%\WinPlay.CarKit.exe" "%sourceDir%\carkit-bridge.cpp"
if errorlevel 1 exit /b 1
cl %opts% /Fo"%outputDir%\usb-topology.obj" /Fe"%outputDir%\WinPlay.UsbTopology.exe" "%sourceDir%\topology.cpp"
if errorlevel 1 exit /b 1
cl %opts% /LD /I"%~dp0..\node_modules\node-api-headers\include" /Fo"%outputDir%\window-sizing.obj" /Fe"%outputDir%\WinPlay.WindowSizing.node" "%sourceDir%\..\window-sizing.cpp" /link user32.lib comctl32.lib
exit /b %errorlevel%
