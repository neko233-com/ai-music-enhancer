param(
    [ValidateSet('cpu', 'cuda')][string]$Device = 'cpu',
    [ValidateRange(1, 64)][int]$Threads = [Math]::Min(8, [Environment]::ProcessorCount)
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $pythonPath)) { throw 'Run scripts/setup-local.ps1 first.' }
$env:HF_HUB_OFFLINE = '1'
$env:TRANSFORMERS_OFFLINE = '1'
$env:HF_HUB_DISABLE_TELEMETRY = '1'
$env:NEKO_DEVICE = $Device
$env:NEKO_CPU_THREADS = "$Threads"
Write-Host "Offline studio ($Device): http://127.0.0.1:8765 (Ctrl+C to stop)"
& $pythonPath -m local.server
exit $LASTEXITCODE
