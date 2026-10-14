; Custom NSIS script for the InputSplit installer (electron-builder `nsis.include`).

; The installer file is called InputSplit.exe, the same as the app. electron-builder's
; stock "is the app running?" check skips itself when the installer's own process has the
; app's file name, so the installer would try to replace files the running app still holds.
; This is the same check without that guard: it finds the app by its install folder
; (PowerShell) or by name excluding the installer's own process (tasklist).
!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  Var /GLOBAL pid
  System::Call 'kernel32::GetCurrentProcessId() i.s'
  Pop $pid

  ${if} ${isUpdated}
    ; The app quits by itself before it starts the update.
    Sleep 1000
  ${endIf}

  !insertmacro INPUTSPLIT_FIND_APP $R0
  ${if} $R0 == 0
    ${ifNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK inputsplit_stop
      Quit
    ${endIf}
    inputsplit_stop:
    DetailPrint "$(appClosing)"
    !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 0
    StrCpy $R1 0
    inputsplit_wait:
      Sleep 1000
      !insertmacro INPUTSPLIT_FIND_APP $R0
      StrCmp $R0 0 0 inputsplit_closed
      IntOp $R1 $R1 + 1
      !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 1
      IntCmp $R1 5 inputsplit_ask inputsplit_wait inputsplit_ask
    inputsplit_ask:
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY inputsplit_retry
      Quit
    inputsplit_retry:
      StrCpy $R1 0
      Goto inputsplit_wait
    inputsplit_closed:
  ${endIf}
!macroend

; $0-style result in _RETURN: 0 when the app is running.
!macro INPUTSPLIT_FIND_APP _RETURN
  ${if} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -C "if ((Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.ProcessId -ne $pid -and $$_.Path.StartsWith('$INSTDIR\', 'CurrentCultureIgnoreCase')}).Count -gt 0) { exit 0 } else { exit 1 }"`
  ${else}
    nsExec::Exec `"$CmdPath" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FI "PID ne $pid" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  ${endIf}
  Pop ${_RETURN}
!macroend
