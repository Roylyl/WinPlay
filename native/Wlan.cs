// Read the exact association and profile on one Windows WLAN interface.
using System;
using System.Collections.Generic;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Xml;

internal static class Wlan {
    const int CurrentConnection = 7, ChannelNumber = 8;
    const uint PlaintextKey = 4;

    // Only the fixed prefix of WLAN_CONNECTION_ATTRIBUTES through dot11Bssid is needed.
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Connection {
        public int state, mode;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string profile;
        public uint ssidLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] ssid;
        public int bssType;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)] public byte[] bssid;
    }

    [DllImport("wlanapi.dll")] static extern uint WlanOpenHandle(uint version, IntPtr reserved, out uint negotiated, out IntPtr handle);
    [DllImport("wlanapi.dll")] static extern uint WlanCloseHandle(IntPtr handle, IntPtr reserved);
    [DllImport("wlanapi.dll")] static extern uint WlanQueryInterface(IntPtr handle, ref Guid id, int opcode, IntPtr reserved, out uint size, out IntPtr data, IntPtr opcodeType);
    [DllImport("wlanapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern uint WlanGetProfile(IntPtr handle, ref Guid id, string profile, IntPtr reserved, out IntPtr xml, ref uint flags, IntPtr access);
    [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr data);

    static int ReadChannel(IntPtr handle, Guid id) {
        uint size;
        IntPtr data;
        if (WlanQueryInterface(handle, ref id, ChannelNumber, IntPtr.Zero, out size, out data, IntPtr.Zero) != 0) return 0;
        try { return size >= 4 ? Marshal.ReadInt32(data) : 0; }
        finally { WlanFreeMemory(data); }
    }

    internal static string SharedPassword(string xml, string ssidHex) {
        var doc = new XmlDocument { XmlResolver = null, PreserveWhitespace = true };
        doc.LoadXml(xml);
        var ns = new XmlNamespaceManager(doc.NameTable);
        ns.AddNamespace("w", "http://www.microsoft.com/networking/WLAN/profile/v1");
        bool matches = false;
        foreach (XmlNode ssid in doc.SelectNodes("/w:WLANProfile/w:SSIDConfig/w:SSID", ns)) {
            var hex = ssid.SelectSingleNode("w:hex", ns);
            var name = ssid.SelectSingleNode("w:name", ns);
            string encoded = hex != null ? hex.InnerText : name == null ? "" : BitConverter.ToString(Encoding.UTF8.GetBytes(name.InnerText)).Replace("-", "");
            if (String.Equals(encoded, ssidHex, StringComparison.OrdinalIgnoreCase)) { matches = true; break; }
        }
        if (!matches) return null;
        var sharedKey = doc.SelectSingleNode("/w:WLANProfile/w:MSM/w:security/w:sharedKey", ns);
        if (sharedKey == null) return null;
        var protection = sharedKey.SelectSingleNode("w:protected", ns);
        if (protection == null || (protection.InnerText != "false" && protection.InnerText != "0")) return null;
        var key = sharedKey.SelectSingleNode("w:keyMaterial", ns);
        return key == null ? null : key.InnerText;
    }

    static string ReadPassword(IntPtr handle, Guid id, string profile, string ssidHex) {
        IntPtr xml;
        uint flags = PlaintextKey;
        if (String.IsNullOrEmpty(profile) || WlanGetProfile(handle, ref id, profile, IntPtr.Zero, out xml, ref flags, IntPtr.Zero) != 0) return null;
        try { return SharedPassword(Marshal.PtrToStringUni(xml), ssidHex); }
        catch (XmlException) { return null; }
        finally { WlanFreeMemory(xml); }
    }

    public static object Current(string selectedName, bool includePassword) {
        uint version;
        IntPtr handle;
        uint error = WlanOpenHandle(2, IntPtr.Zero, out version, out handle);
        if (error != 0) return new { ok = false, code = error };
        try {
            error = 1168; // ERROR_NOT_FOUND
            foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces()) {
                if (adapter.NetworkInterfaceType != NetworkInterfaceType.Wireless80211) continue;
                if (!String.IsNullOrEmpty(selectedName) && !String.Equals(selectedName, adapter.Name, StringComparison.OrdinalIgnoreCase)) continue;
                Guid id;
                if (!Guid.TryParse(adapter.Id, out id)) continue;
                IntPtr data;
                uint size;
                uint query = WlanQueryInterface(handle, ref id, CurrentConnection, IntPtr.Zero, out size, out data, IntPtr.Zero);
                if (query != 0) { error = query; continue; }
                Connection connection;
                try {
                    if (size < Marshal.SizeOf(typeof(Connection))) continue;
                    connection = (Connection)Marshal.PtrToStructure(data, typeof(Connection));
                } finally { WlanFreeMemory(data); }
                if (connection.state != 1 || connection.ssidLength == 0 || connection.ssidLength > 32) continue;
                string hex = BitConverter.ToString(connection.ssid, 0, (int)connection.ssidLength).Replace("-", "");
                var result = new Dictionary<string, object> {
                    {"ok", true}, {"ssidHex", hex}, {"interfaceName", adapter.Name},
                    {"channel", ReadChannel(handle, id)}, {"bssid", BitConverter.ToString(connection.bssid).Replace("-", ":")}
                };
                if (includePassword) {
                    var password = ReadPassword(handle, id, connection.profile, hex);
                    if (!String.IsNullOrEmpty(password)) result["password"] = password;
                }
                return result;
            }
            return new { ok = false, code = error };
        } finally { WlanCloseHandle(handle, IntPtr.Zero); }
    }
}
