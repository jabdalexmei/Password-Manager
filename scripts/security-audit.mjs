import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';

function die(msg) {
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (res.error) {
    // eslint-disable-next-line no-console
    console.error(res.error);
    process.exit(1);
  }
  if (typeof res.status === 'number' && res.status !== 0) {
    process.exit(res.status);
  }
}

function tryRun(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: 'ignore',
    shell: process.platform === 'win32',
    ...opts,
  });
  return res.status === 0;
}

function ensureFile(path, hint) {
  if (!existsSync(path)) {
    die(`Missing required file: ${path}${hint ? ` (${hint})` : ''}`);
  }
}

function auditJs() {
  ensureFile('package.json', 'run from repo root');
  // package-lock.json is expected for deterministic installs via `npm ci`
  ensureFile('package-lock.json', 'commit lockfile; use `npm ci` in CI');

  // Fail CI only on high+ by default; adjust if you want stricter.
  run('npm', ['audit', '--audit-level=high']);
}

function ensureCargoAuditInstalled() {
  if (tryRun('cargo', ['audit', '--version'])) {
    return;
  }
  // Install cargo-audit deterministically.
  run('cargo', ['install', 'cargo-audit', '--locked']);
}

function auditRust() {
  // Tauri Rust workspace lives under src-tauri/
  ensureFile('src-tauri/Cargo.toml', 'expected Tauri Rust crate');

  // Cargo.lock is required for deterministic auditing and locked builds.
  ensureFile('src-tauri/Cargo.lock', 'commit lockfile for deterministic dependency graph');

  ensureCargoAuditInstalled();

  // Run audit in src-tauri directory (works on stable Cargo).
  run('cargo', ['audit'], { cwd: 'src-tauri' });

  // Ensure builds are "locked": no lockfile updates, no silent dependency drift.
  run('cargo', ['build', '--locked'], { cwd: 'src-tauri' });
}

const mode = (process.argv[2] ?? 'all').toLowerCase();

switch (mode) {
  case 'all':
    auditJs();
    auditRust();
    break;
  case 'js':
    auditJs();
    break;
  case 'rust':
    auditRust();
    break;
  default:
    die(`Unknown mode "${mode}". Use: all | js | rust`);
}
