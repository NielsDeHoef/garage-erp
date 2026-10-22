# Static file server without HttpListener URL ACL (works without administrator).
$root = $PSScriptRoot
$port = 8765
$ip = [System.Net.IPAddress]::Loopback

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".ico"  = "image/x-icon"
  ".webmanifest" = "application/manifest+json"
}

$listener = New-Object System.Net.Sockets.TcpListener $ip, $port
try {
  $listener.Start()
} catch {
  Write-Host "Poort $port is bezet. Sluit het andere programma en probeer opnieuw."
  throw
}

Write-Host "Werkplaats draait op http://127.0.0.1:$port/"
Write-Host "Open dit adres in je browser. Druk Ctrl+C om te stoppen."

function Read-Request($stream) {
  $buffer = New-Object byte[] 8192
  $memory = New-Object System.IO.MemoryStream
  while ($true) {
    $read = $stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) { break }
    $memory.Write($buffer, 0, $read)
    $text = [Text.Encoding]::ASCII.GetString($memory.ToArray())
    if ($text.Contains("`r`n`r`n")) { break }
    if ($memory.Length -gt 65536) { break }
  }
  return [Text.Encoding]::ASCII.GetString($memory.ToArray())
}

function Write-Http($stream, $status, $contentType, $bytes) {
  $header = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
  $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) }
}

while ($true) {
  try {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $raw = Read-Request $stream
    $first = ($raw -split "`r`n")[0]
    $parts = $first -split " "
    $urlPath = if ($parts.Length -ge 2) { $parts[1] } else { "/" }
    $rel = [Uri]::UnescapeDataString(($urlPath -split "\?")[0].TrimStart("/"))
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
    $rootFull = [System.IO.Path]::GetFullPath($root)
    if ($full.StartsWith($rootFull) -and (Test-Path $full -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $type = $mime[$ext]
      if (-not $type) { $type = "application/octet-stream" }
      Write-Http $stream "200 OK" $type $bytes
    } else {
      $msg = [Text.Encoding]::UTF8.GetBytes("Niet gevonden")
      Write-Http $stream "404 Not Found" "text/plain; charset=utf-8" $msg
    }
    $stream.Close()
    $client.Close()
  } catch {
    Write-Host $_.Exception.Message
  }
}
