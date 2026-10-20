; Adds resources\bin to the user PATH on install and removes it on uninstall.
; PowerShell edits the value so the 1024 character limit of NSIS strings does not apply,
; and [Environment]::SetEnvironmentVariable broadcasts the change to new terminals.
; "$$" is a literal "$" in NSIS.

!macro customInstall
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d='$INSTDIR\resources\bin'; $$p=[Environment]::GetEnvironmentVariable('Path','User'); if(-not $$p){$$p=''}; $$e=@($$p -split ';' | Where-Object { $$_ -ne '' }); if($$e -notcontains $$d){ [Environment]::SetEnvironmentVariable('Path',(($$e + $$d) -join ';'),'User') }"`
  Pop $0
!macroend

!macro customUnInstall
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d='$INSTDIR\resources\bin'; $$p=[Environment]::GetEnvironmentVariable('Path','User'); if($$p){ $$e=@($$p -split ';' | Where-Object { $$_ -ne '' -and $$_ -ne $$d }); [Environment]::SetEnvironmentVariable('Path',($$e -join ';'),'User') }"`
  Pop $0
!macroend
