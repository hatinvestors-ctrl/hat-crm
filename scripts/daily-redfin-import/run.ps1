# HAT-AI Daily Redfin Import — Task Scheduler launcher
# Path: HatCRM\scripts\daily-redfin-import\run.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = "$scriptDir\import.log"

Set-Location $scriptDir

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content $logFile "`n[$timestamp] Starting daily Redfin import..."

try {
  $output = node index.mjs 2>&1
  Add-Content $logFile $output
  Add-Content $logFile "[$timestamp] Completed."
} catch {
  Add-Content $logFile "[$timestamp] ERROR: $_"
}
