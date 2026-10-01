// WinPlay Windows platform bridge. Bluetooth APIs: Microsoft Winsock AF_BTH.
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Collections.Generic;
using System.Web.Script.Serialization;
class Platform {
 [StructLayout(LayoutKind.Sequential, Pack=1)] struct BthAddress {public ushort family;public ulong address;public Guid service;public uint port;}
 [StructLayout(LayoutKind.Sequential)] struct RadioParams {public uint size;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct RadioInfo {public uint size;public ulong address;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=248)]public string name;public uint deviceClass;public ushort subversion;public ushort manufacturer;}
 [StructLayout(LayoutKind.Sequential)] struct SearchParams {public uint size;public int authenticated,remembered,unknown,connected,inquiry;public byte timeout;public IntPtr radio;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct DeviceInfo {public uint size;public ulong address;public uint deviceClass;public int connected,remembered,authenticated;[MarshalAs(UnmanagedType.ByValArray,SizeConst=16)]public byte[] seen;[MarshalAs(UnmanagedType.ByValArray,SizeConst=16)]public byte[] used;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=248)]public string name;}
 [DllImport("ws2_32.dll")]static extern int WSAStartup(ushort version,byte[] data);
 [DllImport("ws2_32.dll")]static extern IntPtr socket(int family,int type,int protocol);
 [DllImport("ws2_32.dll")]static extern int connect(IntPtr s,ref BthAddress a,int length);
 [DllImport("ws2_32.dll")]static extern int recv(IntPtr s,byte[] b,int count,int flags);
 [DllImport("ws2_32.dll")]static extern int send(IntPtr s,byte[] b,int count,int flags);
 [DllImport("ws2_32.dll")]static extern int closesocket(IntPtr s);
 [DllImport("ws2_32.dll")]static extern int WSAGetLastError();
 [DllImport("bthprops.cpl")]static extern IntPtr BluetoothFindFirstRadio(ref RadioParams p,out IntPtr radio);
 [DllImport("bthprops.cpl")]static extern bool BluetoothFindRadioClose(IntPtr find);
 [DllImport("bthprops.cpl")]static extern uint BluetoothGetRadioInfo(IntPtr radio,ref RadioInfo info);
 [DllImport("bthprops.cpl")]static extern IntPtr BluetoothFindFirstDevice(ref SearchParams p,ref DeviceInfo info);
 [DllImport("bthprops.cpl")]static extern bool BluetoothFindNextDevice(IntPtr find,ref DeviceInfo info);
 [DllImport("bthprops.cpl")]static extern bool BluetoothFindDeviceClose(IntPtr find);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);

 [StructLayout(LayoutKind.Sequential)] struct Rect {public int left,top,right,bottom;}
 [StructLayout(LayoutKind.Sequential)] struct MonitorInfo {public int size;public Rect monitor,work;public uint flags;}
 [DllImport("user32.dll",SetLastError=true)]static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")]static extern IntPtr MonitorFromWindow(IntPtr window,uint flags);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr window,out Rect rect);
 [DllImport("user32.dll")]static extern bool GetClientRect(IntPtr window,out Rect rect);
 [DllImport("user32.dll",SetLastError=true)]static extern bool SetWindowPos(IntPtr window,IntPtr insertAfter,int x,int y,int cx,int cy,uint flags);
 static void WindowMetrics(string[] args){SetProcessDpiAwarenessContext(new IntPtr(-4));Rect client;if(!GetClientRect(new IntPtr(long.Parse(args[1])),out client))throw new Exception("无法读取窗口物理像素");Console.Write(new JavaScriptSerializer().Serialize(new{clientWidth=client.right-client.left,clientHeight=client.bottom-client.top}));}
 static void WindowPixels(string[] args){SetProcessDpiAwarenessContext(new IntPtr(-4));var window=new IntPtr(long.Parse(args[1]));var width=int.Parse(args[2]);var height=int.Parse(args[3]);var info=new MonitorInfo{size=Marshal.SizeOf(typeof(MonitorInfo))};if(!GetMonitorInfo(MonitorFromWindow(window,2),ref info))throw new Exception("无法读取CarPlay窗口所在显示器");int mw=info.monitor.right-info.monitor.left,mh=info.monitor.bottom-info.monitor.top;if(width<320||height<200||width>mw||height>mh)throw new Exception("请求像素超出显示器物理分辨率");int x=info.monitor.left+(mw-width)/2,y=info.monitor.top+(mh-height)/2;if(!SetWindowPos(window,IntPtr.Zero,x,y,width,height,0x14))throw new Exception("无法设置CarPlay物理像素尺寸");Rect client;if(!GetClientRect(window,out client))throw new Exception("无法读取CarPlay画面物理尺寸");int cw=client.right-client.left,ch=client.bottom-client.top;if(cw!=width||ch!=height){if(!SetWindowPos(window,IntPtr.Zero,x,y,width+width-cw,height+height-ch,0x14)||!GetClientRect(window,out client))throw new Exception("无法校正CarPlay画面物理尺寸");cw=client.right-client.left;ch=client.bottom-client.top;}if(cw!=width||ch!=height)throw new Exception("CarPlay画面物理像素尺寸与请求不一致："+cw+"x"+ch+"，请求"+width+"x"+height);Rect outer;if(!GetWindowRect(window,out outer))throw new Exception("无法读取窗口边框尺寸");bool full=width==mw&&height==mh;int ow=outer.right-outer.left,oh=outer.bottom-outer.top;if(!full&&(ow>info.work.right-info.work.left||oh>info.work.bottom-info.work.top))throw new Exception("请求像素加上系统标题栏后超出屏幕可用区域，请选择较小分辨率或屏幕原生像素");if(!full){x=info.work.left+(info.work.right-info.work.left-ow)/2;y=info.work.top+(info.work.bottom-info.work.top-oh)/2;SetWindowPos(window,IntPtr.Zero,x,y,ow,oh,0x15);}Console.Write(new JavaScriptSerializer().Serialize(new{clientWidth=cw,clientHeight=ch,monitorWidth=mw,monitorHeight=mh,x=x,y=y,fullScreen=width==mw&&height==mh}));}

 static string Mac(ulong a){var items=new List<string>();for(int i=5;i>=0;i--)items.Add(((a>>(8*i))&255).ToString("X2"));return string.Join(":",items.ToArray());}
 static void List(){var p=new RadioParams{size=(uint)Marshal.SizeOf(typeof(RadioParams))};IntPtr radio;var handle=BluetoothFindFirstRadio(ref p,out radio);if(handle==IntPtr.Zero)throw new Exception("Windows未检测到可用蓝牙适配器");try{
  var info=new RadioInfo{size=(uint)Marshal.SizeOf(typeof(RadioInfo))};if(BluetoothGetRadioInfo(radio,ref info)!=0)throw new Exception("无法读取蓝牙适配器");
  var search=new SearchParams{size=(uint)Marshal.SizeOf(typeof(SearchParams)),authenticated=1,remembered=1,connected=1,radio=radio};
  var device=new DeviceInfo{size=(uint)Marshal.SizeOf(typeof(DeviceInfo))};var items=new List<object>();var find=BluetoothFindFirstDevice(ref search,ref device);
  if(find!=IntPtr.Zero){try{do{items.Add(new{name=device.name,address=Mac(device.address)});device.size=(uint)Marshal.SizeOf(typeof(DeviceInfo));}while(BluetoothFindNextDevice(find,ref device));}finally{BluetoothFindDeviceClose(find);}}
  Console.Write(new JavaScriptSerializer().Serialize(new{adapter=Mac(info.address),devices=items}));
 }finally{BluetoothFindRadioClose(handle);CloseHandle(radio);}}
 static void Bluetooth(string mac){if(WSAStartup(0x202,new byte[512])!=0)throw new Exception("Winsock初始化失败");var s=socket(32,1,3);if(s==new IntPtr(-1))throw new Exception("无法创建RFCOMM套接字");try{
  var a=new BthAddress{family=32,address=Convert.ToUInt64(mac.Replace(":",""),16),service=new Guid("00000000-deca-fade-deca-deafdecacafe"),port=0};
  if(connect(s,ref a,Marshal.SizeOf(typeof(BthAddress)))!=0)throw new Exception("RFCOMM/SDP连接失败，Windows错误码="+WSAGetLastError());
  var input=Console.OpenStandardInput();var output=Console.OpenStandardOutput();var tx=new Thread(()=>{try{var b=new byte[65536];int n;while((n=input.Read(b,0,b.Length))>0){int offset=0;while(offset<n){var block=new byte[n-offset];Buffer.BlockCopy(b,offset,block,0,block.Length);int done=send(s,block,block.Length,0);if(done<=0)return;offset+=done;}}}finally{closesocket(s);}});tx.IsBackground=true;tx.Start();
  var rx=new byte[65536];int count;while((count=recv(s,rx,rx.Length,0))>0){output.Write(rx,0,count);output.Flush();}
 }finally{closesocket(s);}}
 static int Main(string[] args){Console.OutputEncoding=new UTF8Encoding(false);try{if(args.Length==0)return 2;if(args[0]=="window-metrics"){WindowMetrics(args);return 0;}if(args[0]=="window-pixels"){WindowPixels(args);return 0;}if(args[0]=="list"){List();return 0;}if(args[0]=="bluetooth"){Bluetooth(args[1]);return 0;}
  if(args[0]=="protect"||args[0]=="unprotect"){var m=new MemoryStream();Console.OpenStandardInput().CopyTo(m);var data=args[0]=="protect"?ProtectedData.Protect(m.ToArray(),null,DataProtectionScope.CurrentUser):ProtectedData.Unprotect(m.ToArray(),null,DataProtectionScope.CurrentUser);Console.OpenStandardOutput().Write(data,0,data.Length);return 0;}return 2;
 }catch(Exception e){Console.Error.Write(e.Message);return 1;}}
}
