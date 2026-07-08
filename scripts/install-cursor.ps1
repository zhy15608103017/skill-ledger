param(
  [string]$PluginName = "skill-ledger"
)

$ErrorActionPreference = "Stop"

# Example: /add-plugin skill-ledger
Write-Host "Skill Ledger Cursor install command:"
Write-Host "/add-plugin $PluginName"
Write-Host ""
Write-Host "Run this command inside Cursor Agent chat. For local development, point Cursor at this repository as a plugin directory."
