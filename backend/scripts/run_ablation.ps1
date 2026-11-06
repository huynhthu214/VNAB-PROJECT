param(
  [string]$Provider = "cohere",
  [string]$Subset = "$PSScriptRoot\subsets\ablation",
  [string]$Prefix = "abl",
  [string[]]$Provinces = @("HCM","AG","CM","CT","DN","DT","TN","VL"),
  [string[]]$Only = @()
)
$backendDir = Split-Path $PSScriptRoot -Parent
Set-Location $backendDir

$variants = @(
  @{ Name="m2";       Models="naive_rag";    Env=@{} },
  @{ Name="base0";    Models="advanced_rag"; Env=@{M3_REWRITE="0";M3_RERANK="0";M3_CONTEXT_K="5"} },
  @{ Name="v3a";      Models="advanced_rag"; Env=@{M3_RERANK="0";M3_CONTEXT_K="5"} },
  @{ Name="v3a_safe"; Models="advanced_rag"; Env=@{M3_RERANK="0";M3_CONTEXT_K="5";M3_SAFE_REWRITE="1"} },
  @{ Name="v3b";      Models="advanced_rag"; Env=@{M3_REWRITE="0";M3_CONTEXT_K="5"} },
  @{ Name="v3c";      Models="advanced_rag"; Env=@{M3_REWRITE="0";M3_RERANK="0";M3_CONTEXT_K="12"} },
  @{ Name="full";     Models="advanced_rag"; Env=@{M3_SAFE_REWRITE="1"} }
)
$allKeys = "M3_REWRITE","M3_RERANK","M3_CONTEXT_K","M3_SAFE_REWRITE","M3_SYNTH_ALL","M3_LLM_QUESTION"

foreach ($v in $variants) {
  if ($Only.Count -gt 0 -and $Only -notcontains $v.Name) { continue }
  foreach ($k in $allKeys) { Remove-Item "Env:$k" -ErrorAction SilentlyContinue }
  foreach ($k in $v.Env.Keys) { Set-Item "Env:$k" $v.Env[$k] }
  $env:DEBUG_PROMPT_LOG = "1"

  Write-Host "##### $($v.Name): khởi động backend #####" -ForegroundColor Yellow
  $proc = Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $backendDir -PassThru -WindowStyle Minimized
  $up = $false
  for ($i=0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 2
    try { Invoke-RestMethod "http://localhost:3000/api/v1/health" -TimeoutSec 3 | Out-Null; $up = $true; break } catch {}
  }
  if (-not $up) { Write-Host "Backend không lên, dừng." -ForegroundColor Red; taskkill /PID $proc.Id /T /F | Out-Null; break }

  & "$PSScriptRoot\run_config.ps1" -Tag "$($Prefix)_$($v.Name)" -Models $v.Models -Provider $Provider -Subset $Subset -Provinces $Provinces

  if ($v.Models -eq "advanced_rag" -and (Test-Path .\prompt_debug.jsonl)) {
    $last = Get-Content .\prompt_debug.jsonl -Tail 1 -Encoding UTF8 | ConvertFrom-Json
    Write-Host "flags thực tế: $($last.flags | ConvertTo-Json -Compress)" -ForegroundColor Green
  }
  taskkill /PID $proc.Id /T /F | Out-Null
  Start-Sleep -Seconds 3
}
foreach ($k in $allKeys + "DEBUG_PROMPT_LOG") { Remove-Item "Env:$k" -ErrorAction SilentlyContinue }