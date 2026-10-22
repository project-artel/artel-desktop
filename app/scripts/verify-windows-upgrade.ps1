param(
  [Parameter(Mandatory)][string]$AppDir,
  [Parameter(Mandatory)][string]$WorkDir,
  [Parameter(Mandatory)][string]$BaselineInstaller,
  [Parameter(Mandatory)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
$env:PATH = "$(Split-Path $NodePath);$env:PATH"
Set-Location -LiteralPath $AppDir
$installed = Join-Path $WorkDir 'installed'
$data = Join-Path $WorkDir 'data'
$version = (Get-Content package.json | ConvertFrom-Json).version

function Install-App([string]$Installer) {
  $process = Start-Process $Installer -ArgumentList @('/S', '/currentuser', "/D=$installed") -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(300000)) { throw 'Installer did not exit within five minutes' }
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
}

Install-App $BaselineInstaller
& $NodePath scripts/verify-upgrade.mjs seed "$installed/artel.exe" $data 0.1.0
if ($LASTEXITCODE -ne 0) { throw 'Baseline data creation failed' }

Install-App (Resolve-Path "release/ARTEL-Setup-$version-x64.exe").Path
& $NodePath scripts/verify-upgrade.mjs verify "$installed/artel.exe" $data $version
if ($LASTEXITCODE -ne 0) { throw 'Installer upgrade did not preserve data' }

$next = & $NodePath -e "const s=require('semver');process.stdout.write(s.inc(process.argv[1],'patch'))" $version
$env:ARTEL_RUNTIME_SOURCE = "$installed/resources/runtime"
$env:TARGET_ARCH = 'x64'
& $NodePath node_modules/typescript/bin/tsc -p tsconfig.build.json
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
& $NodePath scripts/write-shims.mjs
if ($LASTEXITCODE -ne 0) { throw 'Shim build failed' }
& $NodePath node_modules/electron-builder/cli.js --config electron-builder.config.mjs --win --x64 --publish never "--config.extraMetadata.version=$next" --config.directories.output=build/update-target
if ($LASTEXITCODE -ne 0) { throw 'Update target build failed' }
& $NodePath scripts/verify-upgrade.mjs auto "$installed/artel.exe" $data $next build/update-target
if ($LASTEXITCODE -ne 0) { throw 'Automatic update did not preserve data' }
