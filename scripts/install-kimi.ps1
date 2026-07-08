param(
  [string]$RepoUrl = "https://github.com/<owner>/skill-ledger"
)

$ErrorActionPreference = "Stop"

# Example: /plugins install https://github.com/<owner>/skill-ledger
Write-Host "Skill Ledger Kimi Code install command:"
Write-Host "/plugins install $RepoUrl"
Write-Host ""
Write-Host "Run this command inside Kimi Code, then start a new session so the plugin is reloaded."
