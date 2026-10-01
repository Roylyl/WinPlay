# SPDX-License-Identifier: GPL-3.0-or-later
# Original vector artwork referencing the AndroidPlay/MacPlay icon family.
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName System.Drawing
$iconRoot=Join-Path $projectRoot 'resources/icons'
New-Item -ItemType Directory -Force $iconRoot | Out-Null
function RoundPath([single]$x,[single]$y,[single]$w,[single]$h,[single]$r){
 $p=New-Object System.Drawing.Drawing2D.GraphicsPath
 $d=$r*2
 $p.AddArc($x,$y,$d,$d,180,90);$p.AddArc($x+$w-$d,$y,$d,$d,270,90)
 $p.AddArc($x+$w-$d,$y+$h-$d,$d,$d,0,90);$p.AddArc($x,$y+$h-$d,$d,$d,90,90);$p.CloseFigure()
 return ,$p
}
$images=@()
foreach($size in @(16,32,48,64,128,256,512)){
 $bitmap=New-Object System.Drawing.Bitmap($size,$size)
 $drawing=[System.Drawing.Graphics]::FromImage($bitmap)
 $drawing.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
 $drawing.Clear([System.Drawing.Color]::Transparent)
 $drawing.ScaleTransform(($size/108.0),($size/108.0))
 $dark=New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#0C111B'))
 $blue=New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#A6C8FF'))
 $screen=New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#101C30'))
 $white=New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#F4F8FF'))
 foreach($shape in @(@(0,0,108,108,24,$dark),@(22,35,64,45,10,$blue),@(27,40,54,31,5,$screen))){$p=RoundPath $shape[0] $shape[1] $shape[2] $shape[3] $shape[4];$drawing.FillPath($shape[5],$p);$p.Dispose()}
 $pen=New-Object System.Drawing.Pen($blue,4);$pen.StartCap=[System.Drawing.Drawing2D.LineCap]::Round;$pen.EndCap=[System.Drawing.Drawing2D.LineCap]::Round
 $drawing.DrawBezier($pen,42,22,50,15.33,58,15.33,66,22);$drawing.DrawBezier($pen,48,28,52,24.66,56,24.66,60,28)
 $drawing.FillRectangle($blue,48,80,12,8);$p=RoundPath 32 87 44 5 2;$drawing.FillPath($blue,$p);$p.Dispose()
 foreach($x in @(34,45)){foreach($y in @(47,57)){$p=RoundPath $x $y 9 8 1;$drawing.FillPath($blue,$p);$p.Dispose()}}
 $drawing.FillPolygon($white,[System.Drawing.PointF[]]@([System.Drawing.PointF]::new(62,46),[System.Drawing.PointF]::new(75,56),[System.Drawing.PointF]::new(62,66)))
 $drawing.FillEllipse($dark,74.5,73.5,3,3)
 $stream=New-Object System.IO.MemoryStream;$bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png);$png=$stream.ToArray()
 if($size -ge 256){[IO.File]::WriteAllBytes((Join-Path $iconRoot "winplay-$size.png"),$png)}
 if($size -le 256){$images+=@{size=$size;bytes=$png}}
 $stream.Dispose();$pen.Dispose();$dark.Dispose();$blue.Dispose();$screen.Dispose();$white.Dispose();$drawing.Dispose();$bitmap.Dispose()
}
$writer=New-Object System.IO.BinaryWriter([System.IO.File]::Create((Join-Path $iconRoot 'winplay.ico')))
$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$images.Count)
$offset=6+16*$images.Count
foreach($entry in $images){$dimension=if($entry.size -eq 256){0}else{$entry.size};$writer.Write([byte]$dimension);$writer.Write([byte]$dimension);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$entry.bytes.Length);$writer.Write([uint32]$offset);$offset+=$entry.bytes.Length}
foreach($entry in $images){$writer.Write([byte[]]$entry.bytes)}$writer.Close()
Copy-Item -LiteralPath (Join-Path $iconRoot 'winplay-256.png') -Destination (Join-Path $projectRoot 'src/ui/winplay.png') -Force
