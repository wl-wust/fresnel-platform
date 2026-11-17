# Arguments: -NoBrowser disables browser launch; -KeepAlive restarts the service after failures.
param(
  [switch]$NoBrowser,
  [switch]$KeepAlive
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDir = Join-Path $Root '.runtime'
$PfxPath = Join-Path $RuntimeDir 'fresnel-local.pfx'
$PasswordText = 'fresnel-local-only'
$Port = 52224
$PcUrl = "https://localhost:$Port/"

New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

$DefaultRoute = Get-NetRoute -DestinationPrefix '0.0.0.0/0' |
  Sort-Object RouteMetric, InterfaceMetric |
  Select-Object -First 1
if (-not $DefaultRoute) {
  throw 'No active LAN connection. Connect the PC to Wi-Fi first.'
}

$LanIp = Get-NetIPAddress -InterfaceIndex $DefaultRoute.InterfaceIndex -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -notlike '127.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress
if (-not $LanIp) {
  throw 'No LAN IPv4 address found. Check the Wi-Fi connection.'
}

Write-Host 'Generating local HTTPS certificate...'
$SecurePassword = ConvertTo-SecureString -String $PasswordText -Force -AsPlainText
$Cert = New-SelfSignedCertificate `
  -Type SSLServerAuthentication `
  -Subject "CN=$LanIp" `
  -TextExtension @("2.5.29.17={text}IPAddress=$LanIp&DNS=localhost") `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears(2)

try {
  Export-PfxCertificate -Cert $Cert -FilePath $PfxPath -Password $SecurePassword | Out-Null
} finally {
  Remove-Item -LiteralPath ("Cert:\CurrentUser\My\" + $Cert.Thumbprint) -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'LAN platform URL:'
Write-Host ("  https://{0}:{1}/" -f $LanIp, $Port) -ForegroundColor Cyan
Write-Host ("  PC fixed URL: {0}" -f $PcUrl)
Write-Host ''
Write-Host 'The phone and PC must use the same Wi-Fi network.'
Write-Host 'On first open, accept the local certificate warning in the phone browser.'
Write-Host 'If Windows Firewall prompts, allow Node.js on Private networks.'
if ($KeepAlive) {
  Write-Host 'Keep-alive is enabled; the service will restart after an unexpected exit.'
} else {
  Write-Host 'Press Ctrl+C to stop.'
}
Write-Host ''

if (-not $NoBrowser) {
  Start-Job -ScriptBlock {
    param($Url)
    Start-Sleep -Seconds 2
    Start-Process $Url
  } -ArgumentList $PcUrl | Out-Null
}

do {
  & node (Join-Path $Root 'tools\lan-video-server.js') `
    --pfx $PfxPath `
    --password $PasswordText `
    --port $Port `
    --root $Root `
    --lan-ip $LanIp
  $ExitCode = $LASTEXITCODE
  if ($KeepAlive -and $ExitCode -ne 0) {
    Write-Warning "LAN service exited with code $ExitCode; restarting in 2 seconds."
    Start-Sleep -Seconds 2
  }
} while ($KeepAlive -and $ExitCode -ne 0)

exit $ExitCode
