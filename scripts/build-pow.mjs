import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'pow-wasm', 'Cargo.toml');
const destinationDir = path.join(repoRoot, 'client', 'public', 'pow');
const destination = path.join(destinationDir, 'csgofriberg_pow.wasm');
const sourceHashFile = path.join(destinationDir, 'source.sha256');
const sourceFiles = [
  path.join(repoRoot, 'pow-wasm', 'Cargo.toml'),
  path.join(repoRoot, 'pow-wasm', 'Cargo.lock'),
  path.join(repoRoot, 'pow-wasm', 'src', 'lib.rs'),
];
const sourceHash = createHash('sha256');
for (const file of sourceFiles) {
  sourceHash.update(path.relative(repoRoot, file));
  sourceHash.update('\0');
  sourceHash.update(readFileSync(file));
  sourceHash.update('\0');
}
const expectedSourceHash = sourceHash.digest('hex');
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

if (result.error || result.status !== 0) {
  const reason = result.error?.message || `Cargo 退出码 ${result.status ?? 'unknown'}`;
  const precompiledMatchesSource = existsSync(destination)
    && existsSync(sourceHashFile)
    && readFileSync(sourceHashFile, 'utf8').trim() === expectedSourceHash;
  if (precompiledMatchesSource) {
    console.warn(`[build:pow] Rust 构建不可用(${reason}),使用已有的预编译 PoW WASM`);
    process.exit(0);
  }
  console.error(`[build:pow] Rust 构建不可用且没有与当前源码匹配的预编译 PoW WASM: ${reason}`);
  process.exit(result.status || 1);
}

const source = path.join(
  repoRoot,
  'pow-wasm',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'csgofriberg_pow.wasm'
);
mkdirSync(destinationDir, { recursive: true });
copyFileSync(source, destination);
writeFileSync(sourceHashFile, `${expectedSourceHash}\n`);
console.log('[build:pow] PoW WASM 构建完成');
