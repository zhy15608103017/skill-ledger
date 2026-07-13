param(
  [string]$RepoUrl = "https://github.com/zhy15608103017/skill-ledger",
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

# Example: gemini extensions install https://github.com/zhy15608103017/skill-ledger
$command = "gemini extensions install $RepoUrl"
Write-Host "Skill Ledger Gemini install command:"
Write-Host $command

$gemini = Get-Command gemini -ErrorAction SilentlyContinue
if ($PrintOnly -or -not $gemini) {
  Write-Host ""
  Write-Host "Run this command after confirming Gemini CLI is available."
  exit 0
}

& $gemini.Source extensions install $RepoUrl
