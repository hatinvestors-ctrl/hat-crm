# Run this once as Administrator to register the Task Scheduler job.
# 10am Israel time = 7am UTC (summer/IDT). Adjust to 8am UTC in winter (IST=UTC+2).

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$scriptDir\run.ps1`""

# 7am UTC = 10am IDT (Israel Daylight Time, UTC+3, Apr–Oct)
$trigger = New-ScheduledTaskTrigger -Daily -At "07:00AM"

$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable

Register-ScheduledTask `
  -TaskName "HAT-AI Redfin Import" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -RunLevel Highest `
  -Force

Write-Output "✅ Task 'HAT-AI Redfin Import' registered — runs daily at 7am UTC (10am Israel time)"
Write-Output "   View/edit: Task Scheduler → Task Scheduler Library → HAT-AI Redfin Import"
