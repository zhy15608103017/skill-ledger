param(
  [string]$Marketplace = "<owner>/skill-ledger-marketplace",
  [string]$PluginSpec = "skill-ledger@skill-ledger-marketplace",
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

# Example: copilot plugin install skill-ledger@skill-ledger-marketplace
$commands = @(
  "copilot plugin marketplace add $Marketplace",
  "copilot plugin install $PluginSpec"
)

Write-Host "Skill Ledger GitHub Copilot CLI install commands:"
$commands | ForEach-Object { Write-Host $_ }

$copilot = Get-Command copilot -ErrorAction SilentlyContinue
if ($PrintOnly -or -not $copilot -or $Marketplace.Contains("<owner>")) {
  Write-Host ""
  Write-Host "Run these commands after replacing <owner> and confirming Copilot CLI is available."
  exit 0
}

& $copilot.Source plugin marketplace add $Marketplace
& $copilot.Source plugin install $PluginSpec
