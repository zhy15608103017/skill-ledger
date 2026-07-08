param(
  [string]$Marketplace = "https://github.com/<owner>/skill-ledger",
  [string]$PluginSpec = "skill-ledger@skill-ledger",
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

# Example: droid plugin install skill-ledger@skill-ledger
$commands = @(
  "droid plugin marketplace add $Marketplace",
  "droid plugin install $PluginSpec"
)

Write-Host "Skill Ledger Factory Droid install commands:"
$commands | ForEach-Object { Write-Host $_ }
Write-Host ""
Write-Host "This is an install-route compatibility surface. Verify in a fresh Droid session before treating it as fully validated."

$droid = Get-Command droid -ErrorAction SilentlyContinue
if ($PrintOnly -or -not $droid -or $Marketplace.Contains("<owner>")) {
  Write-Host ""
  Write-Host "Run these commands after replacing <owner> and confirming Droid is available."
  exit 0
}

& $droid.Source plugin marketplace add $Marketplace
& $droid.Source plugin install $PluginSpec
