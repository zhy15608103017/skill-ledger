param(
  [string]$Marketplace = "<owner>/skill-ledger-marketplace",
  [string]$PluginSpec = "skill-ledger@skill-ledger-marketplace"
)

$ErrorActionPreference = "Stop"

# Example: /plugin install skill-ledger@skill-ledger-marketplace
Write-Host "Skill Ledger Claude Code install commands:"
Write-Host "/plugin marketplace add $Marketplace"
Write-Host "/plugin install $PluginSpec"
Write-Host ""
Write-Host "Run these commands inside Claude Code. For local development, point Claude Code at this repository as a plugin directory."
