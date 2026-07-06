param(
  [string]$PluginRoot = "",
  [string]$MarketplacePath = "",
  [switch]$SkipCodexAdd
)

$ErrorActionPreference = "Stop"

$pluginName = "skill-ledger"
$legacyPluginName = "skill-audit"

if (-not $PluginRoot) {
  $PluginRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $PluginRoot = (Resolve-Path $PluginRoot).Path
}

if (-not $MarketplacePath) {
  $MarketplacePath = Join-Path $HOME ".agents\plugins\marketplace.json"
}

$pluginsDir = Join-Path $HOME "plugins"
$pluginLink = Join-Path $pluginsDir $pluginName
$legacyPluginLink = Join-Path $pluginsDir $legacyPluginName
$sourcePath = "./plugins/skill-ledger"

New-Item -ItemType Directory -Path $pluginsDir -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $MarketplacePath) -Force | Out-Null

if (Test-Path -LiteralPath $pluginLink) {
  $existing = Get-Item -LiteralPath $pluginLink -Force
  $isSameLink = $false

  if ($existing.LinkType -eq "Junction" -or $existing.LinkType -eq "SymbolicLink") {
    $target = @($existing.Target)[0]
    if ($target) {
      $resolvedTarget = (Resolve-Path $target).Path
      $isSameLink = $resolvedTarget -eq $PluginRoot
    }
  } elseif ((Resolve-Path $pluginLink).Path -eq $PluginRoot) {
    $isSameLink = $true
  }

  if (-not $isSameLink) {
    throw "Install target already exists and does not point at this plugin: $pluginLink"
  }
} else {
  New-Item -ItemType Junction -Path $pluginLink -Target $PluginRoot | Out-Null
}

if (Test-Path -LiteralPath $legacyPluginLink) {
  $legacy = Get-Item -LiteralPath $legacyPluginLink -Force
  if ($legacy.LinkType -eq "Junction" -or $legacy.LinkType -eq "SymbolicLink") {
    $legacyTarget = @($legacy.Target)[0]
    if ($legacyTarget -and (Resolve-Path $legacyTarget).Path -eq $PluginRoot) {
      $legacy.Delete()
      Write-Host "Removed legacy plugin link: $legacyPluginLink"
    }
  }
}

if (Test-Path -LiteralPath $MarketplacePath) {
  $raw = Get-Content -Raw -LiteralPath $MarketplacePath
  if ($raw.Trim()) {
    $marketplace = $raw | ConvertFrom-Json
  } else {
    $marketplace = [pscustomobject]@{}
  }
} else {
  $marketplace = [pscustomobject]@{}
}

if (-not $marketplace.PSObject.Properties["name"]) {
  $marketplace | Add-Member -NotePropertyName "name" -NotePropertyValue "personal"
}

if (-not $marketplace.PSObject.Properties["interface"]) {
  $marketplace | Add-Member -NotePropertyName "interface" -NotePropertyValue ([pscustomobject]@{
      displayName = "Personal"
    })
}

if (-not $marketplace.PSObject.Properties["plugins"]) {
  $marketplace | Add-Member -NotePropertyName "plugins" -NotePropertyValue @()
}

$entry = [pscustomobject]@{
  name   = $pluginName
  source = [pscustomobject]@{
    source = "local"
    path   = $sourcePath
  }
  policy = [pscustomobject]@{
    installation   = "AVAILABLE"
    authentication = "ON_INSTALL"
  }
  category = "Developer Tools"
}

$marketplace.plugins = @(@($marketplace.plugins) | Where-Object { $_.name -ne $pluginName -and $_.name -ne $legacyPluginName }) + $entry
$json = ($marketplace | ConvertTo-Json -Depth 20) + [Environment]::NewLine
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($MarketplacePath, $json, $utf8NoBom)

$installCommand = "codex plugin add skill-ledger@$($marketplace.name)"

Write-Host "Skill Ledger Codex marketplace entry is ready."
Write-Host "Plugin root: $PluginRoot"
Write-Host "Plugin link: $pluginLink"
Write-Host "Marketplace: $MarketplacePath"
Write-Host "Install command: $installCommand"

if ($SkipCodexAdd) {
  exit 0
}

$codex = Get-Command codex.cmd -ErrorAction SilentlyContinue
if (-not $codex) {
  $codex = Get-Command codex -ErrorAction SilentlyContinue
}
if (-not $codex) {
  Write-Warning "The codex command was not found. Run this after Codex CLI is available: $installCommand"
  exit 0
}

& $codex.Source plugin add "skill-ledger@$($marketplace.name)"
