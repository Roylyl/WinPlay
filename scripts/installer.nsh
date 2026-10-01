; Avoid a second whole-file read before the wizard. The embedded archive
; still validates its entries during extraction; Windows security is unchanged.
!macro customHeader
  CRCCheck off
!macroend

!macro customInstall
  FileOpen $0 "$INSTDIR\VERSION.txt" w
  FileWrite $0 "WinPlay 1.1.0"
  FileClose $0
!macroend
