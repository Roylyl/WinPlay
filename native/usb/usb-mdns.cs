using System;
using System.Net;
using System.Net.Sockets;
using System.Threading;

public static class UsbMdns {
  static int Main(string[] args) {
    string stage="argument";
    try {
      int index=int.Parse(args[0]);
      if(index<=0)return 2;
      IPAddress group=IPAddress.Parse("ff02::fb");
      IPEndPoint groupEp=new IPEndPoint(new IPAddress(group.GetAddressBytes(),index),5353);
      using(var s=new Socket(AddressFamily.InterNetworkV6,SocketType.Dgram,ProtocolType.Udp)) {
        stage="scope";
        s.DualMode=false;
        s.SetSocketOption(SocketOptionLevel.IPv6,(SocketOptionName)28,1); // IPV6_IFLIST
        s.SetSocketOption(SocketOptionLevel.IPv6,(SocketOptionName)29,index); // IPV6_ADD_IFLIST
        s.SetSocketOption(SocketOptionLevel.IPv6,SocketOptionName.MulticastInterface,index);
        s.SetSocketOption(SocketOptionLevel.IPv6,SocketOptionName.MulticastTimeToLive,255);
        s.SetSocketOption(SocketOptionLevel.IPv6,SocketOptionName.MulticastLoopback,false);
        s.SetSocketOption(SocketOptionLevel.IPv6,SocketOptionName.PacketInformation,true);
        s.ExclusiveAddressUse=false;
        s.SetSocketOption(SocketOptionLevel.Socket,SocketOptionName.ReuseAddress,true);
        // mDNS needs multicast reception. Windows IFLIST above drops all other interfaces.
        stage="bind";
        s.Bind(new IPEndPoint(IPAddress.IPv6Any,5353));
        stage="join";
        s.SetSocketOption(SocketOptionLevel.IPv6,SocketOptionName.AddMembership,new IPv6MulticastOption(group,index));
        Console.WriteLine("READY");
        var reader=new Thread(delegate(){
          var b=new byte[10000];
          for(;;)try{
            EndPoint src=new IPEndPoint(IPAddress.IPv6Any,0);
            SocketFlags flags=SocketFlags.None;IPPacketInformation pkt;
            int n=s.ReceiveMessageFrom(b,0,b.Length,ref flags,ref src,out pkt);
            var remote=(IPEndPoint)src;
            if(pkt.Interface!=index||n<12||n>9000||flags.HasFlag(SocketFlags.Truncated))continue;
            if(!remote.Address.IsIPv6LinkLocal || (remote.Address.ScopeId!=0 && remote.Address.ScopeId!=index))continue;
            Console.WriteLine("RX "+remote.Port+" "+remote.Address+" "+Convert.ToBase64String(b,0,n));
          }catch(SocketException e){Console.WriteLine("RXERR "+e.ErrorCode);return;}catch(ObjectDisposedException){return;}
        });
        reader.IsBackground=true;reader.Start();
        string line;
        while((line=Console.ReadLine())!=null){
          var parts=line.Split(' ');int id,port;
          if(parts.Length!=5 || !int.TryParse(parts[0],out id) || !int.TryParse(parts[2],out port) || port<1 || port>65535)continue;
          if(parts[1]!="M" && parts[1]!="U")continue;
          try {
            var bytes=Convert.FromBase64String(parts[4]);
            if(bytes.Length<12||bytes.Length>9000)continue;
            var dst=groupEp;
            if(parts[1]=="U"){
              IPAddress dest;
              if(!IPAddress.TryParse(parts[3],out dest)||!dest.IsIPv6LinkLocal||dest.ScopeId!=index)continue;
              dst=new IPEndPoint(dest,port);
            }
            int n=s.SendTo(bytes,dst);
            Console.WriteLine((n==bytes.Length?"TX ":"TXERR ")+id);
          }catch(SocketException e){Console.WriteLine("TXERR "+id+" "+e.ErrorCode);}
        }
      }
      return 0;
    }catch(SocketException e){Console.WriteLine("ERR "+stage+" "+e.ErrorCode);return 3;}
     catch(Exception){Console.WriteLine("ERR "+stage);return 4;}
  }
}
