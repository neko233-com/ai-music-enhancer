$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
New-Item -ItemType Directory -Force '.cache/demo-voices' | Out-Null
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voice.SelectVoice('Microsoft Huihui Desktop')
  $voice.Rate = -1
  $voice.SetOutputToWaveFile((Join-Path $projectRoot '.cache/demo-voices/voice-1.wav'))
  $voice.Speak('清晨的风穿过树林，远处传来轻轻的鸟鸣。闭上眼睛，听见声音里的每一处细节。')
  $voice.SetOutputToNull()
  $voice.SelectVoice('Microsoft Zira Desktop')
  $voice.Rate = -1
  $voice.SetOutputToWaveFile((Join-Path $projectRoot '.cache/demo-voices/voice-2.wav'))
  $voice.Speak('Every sound tells a story. Listen to the space between the notes, the quiet breath, and the gentle rhythm of a new day.')
  $voice.SetOutputToNull()
} finally { $voice.Dispose() }
& .venv/Scripts/python.exe scripts/generate-demos.py
if ($LASTEXITCODE -ne 0) { throw 'Demo generation failed' }
