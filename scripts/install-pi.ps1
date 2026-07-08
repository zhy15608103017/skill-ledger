param(
  [string]$PackageSpec = "git:github.com/<owner>/skill-ledger",
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

# Example: pi install git:github.com/<owner>/skill-ledger
$command = "pi install $PackageSpec"
Write-Host "Skill Ledger Pi install command:"
Write-Host $command
Write-Host "Local development command:"
Write-Host "pi -e /path/to/skill-ledger"

$pi = Get-Command pi -ErrorAction SilentlyContinue
if ($PrintOnly -or -not $pi -or $PackageSpec.Contains("<owner>")) {
  Write-Host ""
  Write-Host "Run this command after replacing <owner> and confirming Pi is available."
  exit 0
}

& $pi.Source install $PackageSpec
