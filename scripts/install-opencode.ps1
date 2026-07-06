param(
  [string]$PluginRoot = "",
  [string]$ConfigPath = "",
  [string]$PluginSpec = ""
)

$ErrorActionPreference = "Stop"
$pluginName = "skill-ledger"

if (-not $PluginRoot) {
  $PluginRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $PluginRoot = (Resolve-Path $PluginRoot).Path
}

if (-not $PluginSpec) {
  $PluginSpec = $PluginRoot.Replace("\", "/")
}

if (-not $ConfigPath) {
  $configDir = if ($env:OPENCODE_CONFIG_DIR) {
    $env:OPENCODE_CONFIG_DIR
  } else {
    Join-Path $HOME ".config\opencode"
  }
  $ConfigPath = Join-Path $configDir "opencode.json"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Node.js is required to update opencode.json safely."
}

& $node.Source (Join-Path $PSScriptRoot "update-opencode-config.mjs") --config $ConfigPath --plugin $PluginSpec | Out-Host

Write-Host "Skill Ledger OpenCode config is ready."
Write-Host "Plugin root: $PluginRoot"
Write-Host "Plugin spec: $PluginSpec"
Write-Host "Config: $ConfigPath"
Write-Host "Restart OpenCode to load the plugin."
