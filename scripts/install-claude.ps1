param(
  [string]$MarketplacePath = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path ".claude-plugin\marketplace.json"),
  [string]$PluginSpec = "skill-ledger@skill-ledger-dev",
  [ValidateSet("user", "project", "local")]
  [string]$Scope = "user",
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

$marketplace = (Resolve-Path -LiteralPath $MarketplacePath).Path
$commands = @(
  "claude plugin marketplace add `"$marketplace`"",
  "claude plugin uninstall $PluginSpec --scope $Scope --keep-data --yes",
  "claude plugin install $PluginSpec --scope $Scope"
)

Write-Host "Skill Ledger Claude Code install commands:"
$commands | ForEach-Object { Write-Host $_ }
Write-Host ""

$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($PrintOnly) {
  Write-Host "Run these commands after confirming the Claude Code CLI is available."
  exit 0
}

if (-not $claude) {
  Write-Error "Claude Code CLI was not found. Install Claude Code or add 'claude' to PATH, then rerun this installer. Use -PrintOnly to print commands without installing."
  exit 1
}

& $claude.Source plugin marketplace add $marketplace
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$installedRaw = & $claude.Source plugin list --json
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$installedPlugins = @($installedRaw | ConvertFrom-Json)
$existingPlugin = $installedPlugins | Where-Object { $_.id -eq $PluginSpec -and $_.scope -eq $Scope } | Select-Object -First 1
if ($existingPlugin) {
  Write-Host "Refreshing existing Claude Code plugin install: $PluginSpec"
  & $claude.Source plugin uninstall $PluginSpec --scope $Scope --keep-data --yes
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

& $claude.Source plugin install $PluginSpec --scope $Scope
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
