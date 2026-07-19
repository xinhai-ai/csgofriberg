import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'pow-wasm', 'Cargo.toml');
const windowsCacheRoot = process.env.RUST_CACHE_ROOT || 'E:\\Data\\CacheData\\rust';
const fallbackCargoHome = process.platform === 'win32'
  ? path.join(windowsCacheRoot, 'cargo')
  : undefined;
const cargoHome = process.env.CARGO_HOME || fallbackCargoHome;
const cachedCargo = cargoHome
  ? path.join(cargoHome, 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo')
  : undefined;
const cargo = process.env.CARGO_BIN
  || (cachedCargo && existsSync(cachedCargo) ? cachedCargo : 'cargo');
const childEnv = { ...process.env };
if (cargoHome) childEnv.CARGO_HOME = cargoHome;
if (process.platform === 'win32' && !childEnv.RUSTUP_HOME) {
  childEnv.RUSTUP_HOME = path.join(windowsCacheRoot, 'rustup');
}

const result = spawnSync(
  cargo,
  ['build', '--release', '--target', 'wasm32-unknown-unknown', '--manifest-path', manifestPath],
  { stdio: 'inherit', shell: false, env: childEnv }
);

if (result.error) {
  console.error(`[build:pow] 无法启动 Cargo: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const source = path.join(
  repoRoot,
  'pow-wasm',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'csgofriberg_pow.wasm'
);
const destinationDir = path.join(repoRoot, 'client', 'public', 'pow');
mkdirSync(destinationDir, { recursive: true });
copyFileSync(source, path.join(destinationDir, 'csgofriberg_pow.wasm'));
console.log('[build:pow] PoW WASM 构建完成');
