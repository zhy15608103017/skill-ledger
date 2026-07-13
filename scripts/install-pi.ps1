param(
  [string]$PackageSpec = "git:github.com/zhy15608103017/skill-ledger",
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

# Example: pi install git:github.com/zhy15608103017/skill-ledger
$command = "pi install $PackageSpec"
Write-Host "Skill Ledger Pi install command:"
Write-Host $command
Write-Host "Local development command:"
Write-Host "pi -e /path/to/skill-ledger"

$pi = Get-Command pi -ErrorAction SilentlyContinue
if ($PrintOnly -or -not $pi) {
  Write-Host ""
  Write-Host "Run this command after confirming Pi is available."
  exit 0
}

& $pi.Source install $PackageSpec
