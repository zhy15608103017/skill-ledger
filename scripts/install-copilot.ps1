param(
  [string]$Marketplace = "zhy15608103017/skill-ledger",
  [string]$PluginSpec = "skill-ledger@skill-ledger",
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

# Example: copilot plugin install skill-ledger@skill-ledger
$commands = @(
  "copilot plugin marketplace add $Marketplace",
  "copilot plugin install $PluginSpec"
)

Write-Host "Skill Ledger GitHub Copilot CLI install commands:"
$commands | ForEach-Object { Write-Host $_ }

$copilot = Get-Command copilot -ErrorAction SilentlyContinue
if ($PrintOnly -or -not $copilot) {
  Write-Host ""
  Write-Host "Run these commands after confirming Copilot CLI is available."
  exit 0
}

& $copilot.Source plugin marketplace add $Marketplace
& $copilot.Source plugin install $PluginSpec
