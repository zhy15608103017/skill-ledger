param(
  [string]$RepoUrl = "https://github.com/<owner>/skill-ledger",
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

# Example: gemini extensions install https://github.com/<owner>/skill-ledger
$command = "gemini extensions install $RepoUrl"
Write-Host "Skill Ledger Gemini install command:"
Write-Host $command

$gemini = Get-Command gemini -ErrorAction SilentlyContinue
if ($PrintOnly -or -not $gemini -or $RepoUrl.Contains("<owner>")) {
  Write-Host ""
  Write-Host "Run this command after replacing <owner> and confirming Gemini CLI is available."
  exit 0
}

& $gemini.Source extensions install $RepoUrl
