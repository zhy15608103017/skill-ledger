param(
  [string]$RepoUrl = "https://github.com/<owner>/skill-ledger",
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

# Example: agy plugin install https://github.com/<owner>/skill-ledger
$command = "agy plugin install $RepoUrl"
Write-Host "Skill Ledger Antigravity install command:"
Write-Host $command
Write-Host ""
Write-Host "This is an install-route compatibility surface. Verify in a fresh Antigravity session before treating it as fully validated."

$agy = Get-Command agy -ErrorAction SilentlyContinue
if ($PrintOnly -or -not $agy -or $RepoUrl.Contains("<owner>")) {
  Write-Host ""
  Write-Host "Run this command after replacing <owner> and confirming Antigravity is available."
  exit 0
}

& $agy.Source plugin install $RepoUrl
