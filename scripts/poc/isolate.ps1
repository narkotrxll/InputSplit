<#
.SYNOPSIS
  Phase 1 proof-of-concept driver: isolates one running process with the native helper,
  without the Electron UI. Used for the experiments in docs/TESTING.md.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\poc\isolate.ps1 -Target InputSplitProbe -Slot 0
#>
param(
  [string]$Target = "InputSplitProbe",      # process name without .exe
  [int]$Slot = 0,                            # XInput slot 0..3, or -1 for "do not lock"
  [string]$Helper = "$PSScriptRoot\..\..\native\build\bin\inputsplit-helper.exe",
  [switch]$KeepKeyboard,                     # do not block the keyboard
  [switch]$KeepMouse                         # do not block the mouse
)
$ErrorActionPreference = "Stop"

$helperPath = (Resolve-Path $Helper).Path
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $helperPath
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)

# Lines from the helper are collected by a background event handler.
$lines = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
$null = Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -MessageData $lines -Action {
  if ($EventArgs.Data) { $Event.MessageData.Enqueue($EventArgs.Data) }
}
$proc.BeginOutputReadLine()
$script:nextId = 1

function Invoke-Helper([string]$Method, $Params = @{}, [int]$TimeoutSec = 20) {
  $id = $script:nextId++
  $json = @{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Compress -Depth 6
  $proc.StandardInput.WriteLine($json)
  $proc.StandardInput.Flush()
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $line = $null
    while ($lines.TryDequeue([ref]$line)) {
      $msg = $line | ConvertFrom-Json
      if ($msg.id -eq $id) { return $msg }
      Show-Event $msg
    }
    Start-Sleep -Milliseconds 50
  }
  throw "Timed out waiting for '$Method'"
}

function Show-Event($msg) {
  if (-not $msg.event) { return }
  switch ($msg.event) {
    "sessionStatus" {
      $c = $msg.data.counters
      Write-Host ("[status] active={0} failed={1} xinputReads={2} blockedKb={3} blockedMouse={4} focusEventsSwallowed={5} cursorBlocked={6}" -f `
        ($msg.data.active -join ","), ($msg.data.failed -join ","), $c.xinputReads, $c.blockedKeyboard,
        $c.blockedMouse, $c.swallowedFocusEvents, $c.blockedCursorCalls) -ForegroundColor DarkGray
    }
    "log" { Write-Host ("[{0}/{1}] {2}" -f $msg.data.source, $msg.data.level, $msg.data.message) -ForegroundColor DarkCyan }
    default { Write-Host ("[{0}] {1}" -f $msg.event, ($msg.data | ConvertTo-Json -Compress -Depth 6)) -ForegroundColor Yellow }
  }
}

try {
  $hello = Invoke-Helper "hello"
  Write-Host "Helper $($hello.result.helperVersion) on Windows build $($hello.result.windowsBuild), hook DLL found: $($hello.result.hookDllFound)"
  $null = Invoke-Helper "setEmergencyHotkey" @{ enabled = $true }

  $windows = (Invoke-Helper "listWindows").result.windows
  $window = $windows | Where-Object { $_.exeName -ieq "$Target.exe" } | Select-Object -First 1
  if (-not $window) { throw "No visible window of $Target.exe. Start it first." }
  Write-Host "Target: '$($window.title)' (pid $($window.pid))"

  $check = (Invoke-Helper "checkTarget" @{ pid = $window.pid }).result
  foreach ($w in $check.warnings) { Write-Host "Warning: $($w.message)" -ForegroundColor Yellow }
  if ($check.blockers.Count -gt 0) { throw "Refused: $($check.blockers[0].message)" }

  $features = @{
    activationShield = $true; focusSpoof = $true; xinputBackground = $true
    xinputSlotLock = ($Slot -ge 0); blockKeyboard = (-not $KeepKeyboard)
    blockMouse = (-not $KeepMouse); cursorGuard = $true
  }
  $params = @{ pid = $window.pid; hwnd = $window.hwnd; features = $features }
  if ($Slot -ge 0) { $params.xinputSlot = $Slot }
  $start = Invoke-Helper "startIsolation" $params 30
  if ($start.error) { throw "Start failed: $($start.error.code) - $($start.error.message)" }
  Write-Host "ISOLATION ACTIVE. Confirmed features: $($start.result.active -join ', ')" -ForegroundColor Green
  if ($start.result.failed.Count -gt 0) { Write-Host "Failed: $($start.result.failed -join ', ')" -ForegroundColor Red }
  Write-Host "Emergency stop: Ctrl+Alt+Shift+Q. Press Enter here to stop isolation."

  while (-not [Console]::KeyAvailable) {
    $line = $null
    while ($lines.TryDequeue([ref]$line)) { Show-Event ($line | ConvertFrom-Json) }
    Start-Sleep -Milliseconds 200
  }
  $null = [Console]::ReadLine()
  $stop = Invoke-Helper "stopIsolation" @{ sessionId = $start.result.sessionId }
  Write-Host "Stopped." -ForegroundColor Green
}
finally {
  if (-not $proc.HasExited) {
    $proc.StandardInput.Close()     # the helper stops every session when stdin closes
    $null = $proc.WaitForExit(5000)
  }
  Get-EventSubscriber | Unregister-Event
}
