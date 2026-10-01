// SPDX-License-Identifier: GPL-3.0-or-later
// Native SMTC owner. Audio remains on the user's selected Windows endpoint.
using System;
using System.IO;
using System.Text;
using System.Threading;
using Windows.Foundation;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using Windows.Media;
using Windows.Media.Playback;
using Windows.Media.Control;
using Windows.Storage.Streams;
class MediaBridge {
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)]static extern int SetCurrentProcessExplicitAppUserModelID(string id);
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=8*1024*1024};static readonly object OutputLock=new object();
 static InMemoryRandomAccessStream Artwork;static MediaPlayer Player;static SystemMediaTransportControls Controls;static double Duration;static bool CanSeek;static bool SelfTest;
 static void Send(object value){lock(OutputLock){Console.WriteLine(Json.Serialize(value));Console.Out.Flush();}}
 static string Text(dynamic m,string key){return m.ContainsKey(key)&&m[key]!=null?Convert.ToString(m[key]):"";}
 static double Number(dynamic m,string key){return m.ContainsKey(key)?Math.Max(0,Convert.ToDouble(m[key])):0;}
 static bool Flag(dynamic m,string key){return m.ContainsKey(key)&&Convert.ToBoolean(m[key]);}
 static void Position(double position){if(Duration<=0)return;Controls.UpdateTimelineProperties(new SystemMediaTransportControlsTimelineProperties{StartTime=TimeSpan.Zero,EndTime=TimeSpan.FromMilliseconds(Duration),MinSeekTime=TimeSpan.Zero,MaxSeekTime=TimeSpan.FromMilliseconds(Duration),Position=TimeSpan.FromMilliseconds(Math.Min(Duration,position))});}
 static T Await<T>(IAsyncOperation<T> op){var deadline=DateTime.UtcNow.AddSeconds(5);while(op.Status==AsyncStatus.Started){if(DateTime.UtcNow>deadline)throw new TimeoutException("Windows媒体接口响应超时");Thread.Sleep(10);}return op.GetResults();}
 static void Update(dynamic m){Controls.IsEnabled=true;Controls.IsPlayEnabled=true;Controls.IsPauseEnabled=true;Controls.IsNextEnabled=true;Controls.IsPreviousEnabled=true;CanSeek=Flag(m,"canSeek");Duration=Number(m,"durationMs");var display=Controls.DisplayUpdater;display.Type=MediaPlaybackType.Music;display.AppMediaId="WinPlay";display.MusicProperties.Title=Text(m,"title");display.MusicProperties.Artist=Text(m,"artist");display.MusicProperties.AlbumTitle=Text(m,"album");
  if(Flag(m,"artChanged")){var art=Text(m,"artwork");if(art.Length==0){display.Thumbnail=null;if(Artwork!=null){Artwork.Dispose();Artwork=null;}}else{byte[] bytes=Convert.FromBase64String(art);var memory=new InMemoryRandomAccessStream();var writer=new DataWriter(memory);writer.WriteBytes(bytes);Await<uint>(writer.StoreAsync());writer.DetachStream();writer.Dispose();memory.Seek(0);display.Thumbnail=RandomAccessStreamReference.CreateFromStream(memory);if(Artwork!=null)Artwork.Dispose();Artwork=memory;}}
  display.Update();Controls.PlaybackStatus=Flag(m,"playing")?MediaPlaybackStatus.Playing:MediaPlaybackStatus.Paused;Position(Number(m,"positionMs"));
 }
 static void Inspect(bool control=false){var manager=Await(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());foreach(var s in manager.GetSessions()){var properties=Await(s.TryGetMediaPropertiesAsync());if(properties.Title=="WinPlay SMTC test"||properties.Title=="WinPlay lyric update"){if(control){Await(s.TryPauseAsync());Await(s.TrySkipNextAsync());Await(s.TryChangePlaybackPositionAsync(TimeSpan.FromMilliseconds(5000).Ticks));}Send(new{type="inspection",title=properties.Title,artist=properties.Artist,status=s.GetPlaybackInfo().PlaybackStatus.ToString(),positionMs=s.GetTimelineProperties().Position.TotalMilliseconds,hasArtwork=properties.Thumbnail!=null,source=s.SourceAppUserModelId});return;}}Send(new{type="inspection",missing=true});}
 static void Clear(){Controls.PlaybackStatus=MediaPlaybackStatus.Closed;Controls.IsEnabled=false;Controls.DisplayUpdater.ClearAll();Controls.DisplayUpdater.Update();Duration=0;CanSeek=false;if(Artwork!=null){Artwork.Dispose();Artwork=null;}}
 [MTAThread]static int Main(string[] args){SelfTest=Array.IndexOf(args,"--self-test")>=0;Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);try{SetCurrentProcessExplicitAppUserModelID("io.github.roylyl.winplay");Player=new MediaPlayer();Player.CommandManager.IsEnabled=false;Controls=Player.SystemMediaTransportControls;Controls.ButtonPressed+=(sender,e)=>{int index=e.Button==SystemMediaTransportControlsButton.Play?1:e.Button==SystemMediaTransportControlsButton.Pause?2:e.Button==SystemMediaTransportControlsButton.Next?4:e.Button==SystemMediaTransportControlsButton.Previous?5:0;if(index>0)Send(new{type="command",command="media",index=index});};Controls.PlaybackPositionChangeRequested+=(sender,e)=>{if(CanSeek&&Duration>0)Send(new{type="command",command="seek",ms=Math.Min(Duration,e.RequestedPlaybackPosition.TotalMilliseconds)});};Clear();Send(new{type="ready"});string line;while((line=Console.ReadLine())!=null){try{dynamic m=Json.DeserializeObject(line);string command=Text(m,"command");if(command=="update")Update(m);else if(command=="position")Position(Number(m,"positionMs"));else if(command=="clear")Clear();else if(command=="inspect"&&SelfTest)Inspect();else if(command=="test-control"&&SelfTest)Inspect(true);else if(command=="stop")break;}catch(Exception e){Send(new{type="error",reason=e.Message});}}Clear();Player.Dispose();return 0;}catch(Exception e){Console.Error.Write(e.Message);return 1;}}
}
