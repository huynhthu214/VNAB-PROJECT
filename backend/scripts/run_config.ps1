# Cách dùng (ĐỨNG Ở thư mục backend để .env được nạp; backend ĐÃ khởi động sẵn với cờ tương ứng):
#   .\scripts\run_config.ps1 -Tag m3_3a -Models advanced_rag -Provider gemini -Subset "$PWD\scripts\subsets\ablation"
#   .\run_config.ps1 -Tag m3_3a -Models advanced_rag -Provider gemini -Subset "D:\...\subsets\ablation"
param(
  [Parameter(Mandatory=$true)][string]$Tag,          # tên thư mục kết quả: data\batch_results\<Tag>\<tỉnh>
  [Parameter(Mandatory=$true)][string]$Models,       # vd: advanced_rag  hoặc  advanced_rag,modular_rag
  [string]$Provider = "gemini",
  [Parameter(Mandatory=$true)][string]$Subset,       # thư mục chứa test_matrix_<tỉnh>.xlsx đã lọc
  [string[]]$Provinces = @("HCM","AG","CM","CT","DN","DT","TN","VL")
)
$env:RESULTS_TAG = $Tag
$env:MODELS_OVERRIDE = $Models
$env:LLM_PROVIDER_OVERRIDE = $Provider
foreach ($p in $Provinces) {
  Write-Host "=== $Tag | $p | $Models | $Provider ===" -ForegroundColor Cyan
  $env:PROVINCE = $p
  $env:TEST_SET_PATH = Join-Path $Subset "test_matrix_$p.xlsx"
  node (Join-Path $PSScriptRoot "runBatchTest.js")
  if ($LASTEXITCODE -ne 0) { Write-Host "Lỗi ở tỉnh $p, dừng." -ForegroundColor Red; break }
}
Remove-Item Env:RESULTS_TAG, Env:MODELS_OVERRIDE, Env:LLM_PROVIDER_OVERRIDE, Env:PROVINCE, Env:TEST_SET_PATH -ErrorAction SilentlyContinue