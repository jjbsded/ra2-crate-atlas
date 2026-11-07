param([switch]$NoBrowser, [int]$Port = 8787)
$ErrorActionPreference = 'Stop'
$siteRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$manifestPath = Join-Path $siteRoot 'build-manifest.json'
if (!(Test-Path -LiteralPath $manifestPath)) { throw 'Fully extract the Toy ZIP before starting it.' }
$manifestText = [IO.File]::ReadAllText($manifestPath)
function Get-ManifestId([string]$text) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($text))).Replace('-','').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}
$manifestId = Get-ManifestId $manifestText
$manifest = $manifestText | ConvertFrom-Json
$allowed = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
foreach ($property in $manifest.files.PSObject.Properties) { [void]$allowed.Add($property.Name) }
[void]$allowed.Add('build-manifest.json')
$manifestStamp = ([IO.File]::GetLastWriteTimeUtc($manifestPath)).Ticks
$prefix = '/toy/crate-atlas/'
$listener = $null
for ($candidate = $Port; $candidate -lt [Math]::Min(65536, $Port + 20); $candidate++) {
    $base = "http://127.0.0.1:$candidate"
    try {
        $old = Invoke-WebRequest -UseBasicParsing -Uri ($base+$prefix+'build-manifest.json') -TimeoutSec 1
        if ($old.Content -ceq $manifestText -and ($old.Headers['X-Crate-Atlas-Manifest'] -join ',') -ceq $manifestId) {
            if (!$NoBrowser) { Start-Process ($base+$prefix+'index.html') }
            Write-Output "Already running: $base$prefix"
            exit 0
        }
        if ($old.Content -cne $manifestText) { continue }
    } catch {}
    $listener = New-Object Net.HttpListener
    $listener.Prefixes.Add($base+$prefix)
    try { $listener.Start(); break } catch { $listener.Close(); $listener=$null }
}
if (!$listener) { throw 'No available local port. Close an older Toy server and retry.' }
$types = @{'.html'='text/html; charset=utf-8';'.js'='text/javascript; charset=utf-8';'.css'='text/css; charset=utf-8';'.json'='application/json; charset=utf-8';'.webp'='image/webp';'.png'='image/png';'.jpg'='image/jpeg';'.svg'='image/svg+xml';'.wasm'='application/wasm';'.md'='text/plain; charset=utf-8'}
Write-Output "Toy: $base$prefix"
Write-Output 'Keep this window open. Close it or press Ctrl+C to stop.'
if (!$NoBrowser) { Start-Process ($base+$prefix+'index.html') }
try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $response = $context.Response
        try {
            if (![Net.IPAddress]::IsLoopback($context.Request.RemoteEndPoint.Address)) { $response.StatusCode=403; continue }
            if ($context.Request.HttpMethod -notin @('GET','HEAD')) { $response.StatusCode=405; continue }
            $route = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
            if ($route -eq '/') { $response.Redirect($prefix+'index.html'); continue }
            if (!$route.StartsWith($prefix,[StringComparison]::Ordinal)) { $response.StatusCode=404; continue }
            $relative = $route.Substring($prefix.Length)
            # UI refreshes can add runtime modules while this static server is
            # still running. Publish the new allowlist only after a full parse.
            $updatedStamp = ([IO.File]::GetLastWriteTimeUtc($manifestPath)).Ticks
            if ($updatedStamp -ne $manifestStamp) {
                $updatedText = [IO.File]::ReadAllText($manifestPath)
                $updatedManifest = $updatedText | ConvertFrom-Json
                $updatedAllowed = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
                foreach ($property in $updatedManifest.files.PSObject.Properties) { [void]$updatedAllowed.Add($property.Name) }
                [void]$updatedAllowed.Add('build-manifest.json')
                $allowed=$updatedAllowed; $manifestText=$updatedText; $manifestStamp=$updatedStamp
                $manifestId = Get-ManifestId $manifestText
            }
            if (!$allowed.Contains($relative)) { $response.StatusCode=404; continue }
            $file = [IO.Path]::GetFullPath((Join-Path $siteRoot $relative))
            if (!$file.StartsWith($siteRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { $response.StatusCode=403; continue }
            $extension = [IO.Path]::GetExtension($file)
            $response.ContentType = if ($types.ContainsKey($extension)) { $types[$extension] } else { 'application/octet-stream' }
            $response.Headers['Cache-Control']='no-cache'
            $response.Headers['X-Content-Type-Options']='nosniff'
            $response.Headers['X-Crate-Atlas-Manifest']=$manifestId
            $stream = [IO.File]::OpenRead($file)
            try {
                $response.ContentLength64=$stream.Length
                if ($context.Request.HttpMethod -eq 'GET') { $stream.CopyTo($response.OutputStream) }
            } finally { $stream.Dispose() }
        } catch { try { $response.StatusCode=500 } catch {} }
        finally { $response.Close() }
    }
} finally { $listener.Close() }
