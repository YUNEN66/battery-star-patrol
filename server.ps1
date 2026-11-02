param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1024, 65535)]
  [int]$Port
)

$ErrorActionPreference = "Stop"
$rootPath = [IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = $rootPath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$contentTypes = @{
  ".css" = "text/css; charset=utf-8"
  ".html" = "text/html; charset=utf-8"
  ".ico" = "image/vnd.microsoft.icon"
  ".js" = "text/javascript; charset=utf-8"
  ".json" = "application/manifest+json; charset=utf-8"
  ".png" = "image/png"
  ".svg" = "image/svg+xml; charset=utf-8"
}

function Write-JsonResponse {
  param(
    [Parameter(Mandatory = $true)]$Context,
    [Parameter(Mandatory = $true)][int]$StatusCode,
    [Parameter(Mandatory = $true)]$Payload
  )

  $Context.Response.StatusCode = $StatusCode
  $Context.Response.ContentType = "application/json; charset=utf-8"
  $Context.Response.Headers["Cache-Control"] = "no-store"
  $json = ConvertTo-Json -InputObject $Payload -Depth 5 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $Context.Response.ContentLength64 = $bytes.Length
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Get-BatterySnapshot {
  $batteries = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop)
  if ($batteries.Count -eq 0) {
    return [ordered]@{
      app = "battery-star-patrol"
      source = "windows"
      batteryPresent = $false
      deviceName = ""
      chargePercent = $null
      charging = $false
      designCapacityMWh = $null
      fullChargeCapacityMWh = $null
      cycleCount = $null
      message = "未检测到系统电池。若设备为笔记本电脑，请检查电池连接或驱动。"
    }
  }

  $reportPath = Join-Path ([IO.Path]::GetTempPath()) ("battery-star-patrol-" + [Guid]::NewGuid().ToString("N") + ".xml")
  try {
    $reportOutput = & "$env:SystemRoot\System32\powercfg.exe" /batteryreport /xml /output $reportPath 2>&1
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $reportPath)) {
      throw "Windows did not create an XML battery report."
    }

    [xml]$report = Get-Content -LiteralPath $reportPath -Raw
    $batteryNodes = @($report.SelectNodes("//*[local-name()='Batteries']/*[local-name()='Battery']"))
    $systemNode = $report.SelectSingleNode("//*[local-name()='SystemInformation']")
    $designCapacities = @()
    $fullCapacities = @()
    $cycleCounts = @()

    foreach ($node in $batteryNodes) {
      $design = 0.0
      $full = 0.0
      if ([double]::TryParse([string]$node.DesignCapacity, [Globalization.NumberStyles]::Integer, [Globalization.CultureInfo]::InvariantCulture, [ref]$design) -and $design -gt 0) {
        $designCapacities += $design
      }
      if ([double]::TryParse([string]$node.FullChargeCapacity, [Globalization.NumberStyles]::Integer, [Globalization.CultureInfo]::InvariantCulture, [ref]$full) -and $full -gt 0) {
        $fullCapacities += $full
      }
      $cycle = 0
      if ([int]::TryParse([string]$node.CycleCount, [Globalization.NumberStyles]::Integer, [Globalization.CultureInfo]::InvariantCulture, [ref]$cycle) -and $cycle -ge 0) {
        $cycleCounts += $cycle
      }
    }

    $designTotal = $null
    $fullTotal = $null
    $cycleTotal = $null
    if ($batteryNodes.Count -gt 0 -and $designCapacities.Count -eq $batteryNodes.Count -and $fullCapacities.Count -eq $batteryNodes.Count) {
      $designTotal = [math]::Round(($designCapacities | Measure-Object -Sum).Sum, 0)
      $fullTotal = [math]::Round(($fullCapacities | Measure-Object -Sum).Sum, 0)
    }
    if ($batteryNodes.Count -eq 1 -and $cycleCounts.Count -eq 1) {
      $cycleTotal = $cycleCounts[0]
    }

    $chargePercent = $null
    if ($batteries.Count -eq 1 -and $null -ne $batteries[0].EstimatedChargeRemaining) {
      $chargePercent = [int]$batteries[0].EstimatedChargeRemaining
    } elseif ($batteryNodes.Count -eq 1 -and $null -ne $report.BatteryReport.Batteries.Battery.RelativeCapacity) {
      $relativeCapacity = 0.0
      if ([double]::TryParse([string]$report.BatteryReport.Batteries.Battery.RelativeCapacity, [Globalization.NumberStyles]::Integer, [Globalization.CultureInfo]::InvariantCulture, [ref]$relativeCapacity) -and $relativeCapacity -gt 0) {
        $chargePercent = [math]::Min(100, [int][math]::Round($relativeCapacity))
      }
    }

    $manufacturer = if ($systemNode.SystemManufacturer) { [string]$systemNode.SystemManufacturer } else { "" }
    $model = if ($systemNode.SystemProductName) { [string]$systemNode.SystemProductName } else { "" }
    $deviceName = (@($manufacturer, $model) | Where-Object { $_ -and $_ -ne "To be filled by O.E.M." }) -join " "
    $status = [int]$batteries[0].BatteryStatus
    $charging = $status -in 6, 7, 8, 9

    return [ordered]@{
      app = "battery-star-patrol"
      source = "windows"
      batteryPresent = $true
      deviceName = $deviceName
      chargePercent = $chargePercent
      charging = $charging
      designCapacityMWh = $designTotal
      fullChargeCapacityMWh = $fullTotal
      cycleCount = $cycleTotal
      message = if ($null -eq $designTotal -or $null -eq $fullTotal) { "Windows 报告未提供容量字段；请稍后重新读取或查看厂商诊断页面。" } else { "" }
    }
  } finally {
    if (Test-Path -LiteralPath $reportPath) {
      Remove-Item -LiteralPath $reportPath -Force -ErrorAction SilentlyContinue
    }
  }
}

$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try {
  $listener.Start()
} catch {
  Write-Error "无法启动本机电池服务：$($_.Exception.Message)"
  exit 1
}

while ($listener.IsListening) {
  $context = $null
  try {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    $response.Headers["X-Content-Type-Options"] = "nosniff"
    $response.Headers["Referrer-Policy"] = "no-referrer"
    $response.Headers["X-Frame-Options"] = "DENY"
    $response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    $response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

    if ($request.HttpMethod -ne "GET") {
      Write-JsonResponse -Context $context -StatusCode 405 -Payload @{ app = "battery-star-patrol"; message = "仅支持读取请求。" }
      continue
    }

    if ($request.Url.AbsolutePath -eq "/api/battery") {
      try {
        Write-JsonResponse -Context $context -StatusCode 200 -Payload (Get-BatterySnapshot)
      } catch {
        Write-Warning "读取 Windows 电池报告失败：$($_.Exception.Message)"
        Write-JsonResponse -Context $context -StatusCode 500 -Payload @{
          app = "battery-star-patrol"
          error = "battery_report_failed"
          message = "无法读取 Windows 电池报告。请检查电池驱动后重新打开应用。"
        }
      }
      continue
    }

    $relativePath = [Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
    if (-not $relativePath) { $relativePath = "index.html" }
    $filePath = [IO.Path]::GetFullPath((Join-Path $rootPath $relativePath))
    if (-not $filePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
      Write-JsonResponse -Context $context -StatusCode 404 -Payload @{ app = "battery-star-patrol"; message = "未找到页面。" }
      continue
    }
    $extension = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
    if (-not $contentTypes.ContainsKey($extension)) {
      Write-JsonResponse -Context $context -StatusCode 415 -Payload @{ app = "battery-star-patrol"; message = "不支持的文件类型。" }
      continue
    }
    $fileBytes = [IO.File]::ReadAllBytes($filePath)
    $response.ContentType = $contentTypes[$extension]
    $response.Headers["Cache-Control"] = "no-cache"
    $response.ContentLength64 = $fileBytes.Length
    $response.OutputStream.Write($fileBytes, 0, $fileBytes.Length)
  } catch {
    if ($context) {
      try {
        if (-not $context.Response.OutputStream.CanWrite) { continue }
        Write-Warning "请求处理失败：$($_.Exception.Message)"
        Write-JsonResponse -Context $context -StatusCode 500 -Payload @{ app = "battery-star-patrol"; message = "本机服务遇到错误，请重新打开应用。" }
      } catch {
        Write-Warning "无法返回请求错误：$($_.Exception.Message)"
      }
    }
  } finally {
    if ($context) {
      try { $context.Response.Close() } catch {}
    }
  }
}

$listener.Stop()
$listener.Close()
