$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
function Run-Checked { param([scriptblock]$Command) & $Command; if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" } }
Run-Checked { uv venv --python 3.10 .venv --allow-existing }
Run-Checked { uv pip install --python .venv/Scripts/python.exe torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128 }
Run-Checked { uv pip install --python .venv/Scripts/python.exe -r local/requirements.txt }
Run-Checked { uv pip install --python .venv/Scripts/python.exe audiosr==0.0.7 --no-deps }
Run-Checked { .venv/Scripts/python.exe scripts/download-model.py }
Run-Checked { npm ci }
Run-Checked { npm run build }
Write-Host 'Setup complete. Disconnect from the Internet and run scripts/start-local.ps1.'
