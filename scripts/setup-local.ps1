param([ValidateSet('cpu', 'cuda')][string]$Device = 'cpu')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
function Run-Checked { param([scriptblock]$Command) & $Command; if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" } }
Run-Checked { uv venv --python 3.10 .venv --allow-existing }
if ($Device -eq 'cuda') {
    Run-Checked { uv pip install --python .venv/Scripts/python.exe torch==2.7.1+cu128 torchvision==0.22.1+cu128 torchaudio==2.7.1+cu128 --index-url https://download.pytorch.org/whl/cu128 }
} else {
    # The Windows PyPI wheels are CPU-only; strict versions replace an existing +cu128 build.
    Run-Checked { uv pip install --python .venv/Scripts/python.exe 'torch===2.7.1' 'torchvision===0.22.1' 'torchaudio===2.7.1' --index-url https://pypi.org/simple }
    Run-Checked { .venv/Scripts/python.exe -c "import torch; assert torch.version.cuda is None, 'Expected CPU-only PyTorch'" }
}
Run-Checked { uv pip install --python .venv/Scripts/python.exe -r local/requirements.txt }
Run-Checked { uv pip install --python .venv/Scripts/python.exe audiosr==0.0.7 --no-deps }
Run-Checked { .venv/Scripts/python.exe scripts/download-model.py }
Run-Checked { npm ci }
Run-Checked { npm run build }
Write-Host 'Setup complete. Disconnect from the Internet and run scripts/start-local.ps1.'
