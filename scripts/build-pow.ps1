$ErrorActionPreference = 'Stop'

$rustRoot = if ($env:RUST_CACHE_ROOT) { $env:RUST_CACHE_ROOT } else { 'E:\Data\CacheData\rust' }
$env:RUSTUP_HOME = Join-Path $rustRoot 'rustup'
$env:CARGO_HOME = Join-Path $rustRoot 'cargo'
$cargo = Join-Path $env:CARGO_HOME 'bin\cargo.exe'

if (-not (Test-Path -LiteralPath $cargo)) {
  $cargo = 'cargo'
}

Push-Location (Join-Path $PSScriptRoot '..\pow-wasm')
try {
  & $cargo build --release --target wasm32-unknown-unknown
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $destination = Join-Path $PSScriptRoot '..\client\public\pow'
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  Copy-Item -LiteralPath '.\target\wasm32-unknown-unknown\release\csgofriberg_pow.wasm' `
    -Destination (Join-Path $destination 'csgofriberg_pow.wasm') -Force
} finally {
  Pop-Location
}
