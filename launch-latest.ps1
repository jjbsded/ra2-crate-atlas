param([ValidateSet('full','toy')][string]$Edition='full')
$ErrorActionPreference='Stop'
$releaseRoot=Join-Path $PSScriptRoot 'output'
$release=Get-Content -LiteralPath (Join-Path $releaseRoot 'latest-release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$install=[IO.Path]::GetFullPath((Join-Path $releaseRoot $release.$Edition))
if (!$install.StartsWith([IO.Path]::GetFullPath($releaseRoot)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'Invalid latest release path.'}
Set-Location -LiteralPath $install
if ($Edition -eq 'full') {
    $runtime=Join-Path $install 'runtime\python\python.exe'
    if (!(Test-Path -LiteralPath $runtime)) {throw 'The latest portable installation is incomplete.'}
    & $runtime -B (Join-Path $install 'server.py') --open --page maps
} else {
    & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $install 'serve-toy.ps1')
}
exit $LASTEXITCODE
