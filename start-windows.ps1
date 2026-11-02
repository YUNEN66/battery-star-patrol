$ErrorActionPreference = "Stop"
$port = 49173
$url = "http://127.0.0.1:$port/"
$serverScript = Join-Path $PSScriptRoot "server.ps1"
$shell = Join-Path $PSHOME "powershell.exe"

$browserCandidates = @(
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
)
$browser = $browserCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $browser) {
  $edgeCommand = Get-Command "msedge.exe" -ErrorAction SilentlyContinue
  if ($edgeCommand) { $browser = $edgeCommand.Source }
}

$serverProcess = $null
try {
  $response = Invoke-RestMethod -Uri ($url + "api/battery") -TimeoutSec 2 -ErrorAction Stop
  if ($response.app -ne "battery-star-patrol") { throw "A different local service is already listening on port $port." }
} catch {
  $serverProcess = Start-Process -FilePath $shell `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$serverScript`"", "-Port", "$port") `
    -WindowStyle Hidden -PassThru

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if ($serverProcess.HasExited) { break }
    try {
      $response = Invoke-RestMethod -Uri ($url + "api/battery") -TimeoutSec 2 -ErrorAction Stop
      if ($response.app -eq "battery-star-patrol") { $ready = $true; break }
    } catch {}
  }
  if (-not $ready) {
    if (-not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue }
    throw "本机电池服务启动失败。请在电池文件夹中运行 server.ps1 检查错误信息。"
  }
}

if ($browser) {
  Start-Process -FilePath $browser -ArgumentList @("--app=$url")
} else {
  Start-Process -FilePath $url
}
