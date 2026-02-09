import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'src');

// The only allowed place to mention @zxing/* is the loader.
const allowedFile = path.join(srcRoot, 'shared', 'lib', 'zxingLoader.ts');

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(full)));
      continue;
    }
    if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * @param {string} file
 * @param {string} content
 * @returns {Array<{line: number, text: string}>}
 */
function findOffenses(file, content) {
  if (path.resolve(file) === path.resolve(allowedFile)) return [];

  // Catch:
  //  - import ... from '@zxing/...'
  //  - await import('@zxing/...')
  //  - require('@zxing/...')
  const patterns = [
    /from\s+['"]@zxing\//,
    /import\s*\(\s*['"]@zxing\//,
    /require\s*\(\s*['"]@zxing\//,
    /['"]@zxing\//, // belt & suspenders: any mention outside loader is forbidden
  ];

  const lines = content.split(/\r?\n/);
  /** @type {Array<{line: number, text: string}>} */
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (patterns.some((p) => p.test(lineText))) {
      hits.push({ line: i + 1, text: lineText });
    }
  }
  return hits;
}

const files = await walk(srcRoot);
/** @type {Array<{file: string, hits: Array<{line: number, text: string}>}>} */
const bad = [];

for (const f of files) {
  const content = await readFile(f, 'utf8');
  const hits = findOffenses(f, content);
  if (hits.length) bad.push({ file: f, hits });
}

if (bad.length) {
  console.error('✖ Forbidden @zxing/* usage detected outside src/shared/lib/zxingLoader.ts');
  console.error('  Use the loader instead to keep ZXing lazy and prevent chunk regressions.\n');
  for (const item of bad) {
    const rel = path.relative(projectRoot, item.file);
    console.error(`- ${rel}`);
    for (const h of item.hits) {
      console.error(`    L${h.line}: ${h.text}`);
    }
    console.error('');
  }
  process.exit(1);
}

console.log('✓ ZXing import guard passed');
