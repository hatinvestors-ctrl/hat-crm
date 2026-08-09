# Run this once as Administrator to register the Task Scheduler job.
# Machine is already set to Israel Standard Time, so these are plain local
# wall-clock triggers - no UTC conversion needed.
#
# Runs 3x/day at 10am / 2pm / 6pm. If the laptop is off/asleep at trigger
# time, -StartWhenAvailable fires it as soon as the machine is next awake
# (still capped at these 3 occurrences/day - it won't pile up extra runs).

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$scriptDir\run.ps1`""

$trigger1 = New-ScheduledTaskTrigger -Daily -At "10:00AM"
$trigger2 = New-ScheduledTaskTrigger -Daily -At "02:00PM"
$trigger3 = New-ScheduledTaskTrigger -Daily -At "06:00PM"

$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable

Register-ScheduledTask `
  -TaskName "HAT-AI Redfin Import" `
  -Action $action `
  -Trigger @($trigger1, $trigger2, $trigger3) `
  -Settings $settings `
  -RunLevel Highest `
  -Force

Write-Output "Task 'HAT-AI Redfin Import' registered - runs at 10am / 2pm / 6pm Israel time daily"
Write-Output "(whenever the laptop is on/awake at or after those times - skipped entirely if it is off all day)"
Write-Output "View/edit: Task Scheduler -> Task Scheduler Library -> HAT-AI Redfin Import"
