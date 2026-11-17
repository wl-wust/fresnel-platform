$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $Root 'start-lan-video.ps1'
$TaskName = 'FresnelPlatformLAN'
$CurrentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name

if (-not (Test-Path -LiteralPath $Launcher)) {
  throw "Launcher not found: $Launcher"
}

$Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -NoBrowser -KeepAlive' -f $Launcher
$Action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument $Arguments `
  -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$Principal = New-ScheduledTaskPrincipal `
  -UserId $CurrentUser `
  -LogonType Interactive `
  -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

$Task = New-ScheduledTask `
  -Action $Action `
  -Trigger $Trigger `
  -Principal $Principal `
  -Settings $Settings `
  -Description 'Start the Fresnel experiment LAN video platform after sign-in.'

Register-ScheduledTask `
  -TaskName $TaskName `
  -InputObject $Task `
  -Force | Out-Null

Write-Host ''
Write-Host 'Sign-in autostart installed.' -ForegroundColor Green
Write-Host ("Task name: {0}" -f $TaskName)
Write-Host 'PC URL: https://localhost:52224/'
Write-Host 'Connect the phone and PC to the same Wi-Fi, then scan the QR code.'
Write-Host ''
Write-Host 'Uninstall command:'
Write-Host ('Unregister-ScheduledTask -TaskName "{0}" -Confirm:$false' -f $TaskName)
