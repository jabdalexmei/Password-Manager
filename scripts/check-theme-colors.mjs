import fs from "node:fs";
import path from "node:path";

const ROOT_CANDIDATES = ["src/shared/styles", "src/styles"];
const stylesRoot = ROOT_CANDIDATES
  .map((p) => path.resolve(p))
  .find((p) => fs.existsSync(p));

if (!stylesRoot) {
  console.error(`Styles root not found. Checked: ${ROOT_CANDIDATES.join(", ")}`);
  process.exit(1);
}

const themesDir = path.resolve(stylesRoot, "themes");
const sourceRoot = path.resolve("src");

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/;
const INLINE_STYLE_RE = /style=\{\{[\s\S]*?\}\}/g;
const STYLE_OBJECT_RE = /(?:const|let|var)\s+[A-Za-z0-9_]+\s*:\s*React\.CSSProperties\s*=\s*\{[\s\S]*?\};?/g;

function walk(dir, allowedExts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, allowedExts));
      continue;
    }
    if (!entry.isFile()) continue;
    if (allowedExts.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const themeFiles = fs.existsSync(themesDir)
  ? new Set(walk(themesDir, [".css"]).map((f) => path.resolve(f)))
  : new Set();

const cssFiles = walk(stylesRoot, [".css"]).filter((f) => !themeFiles.has(path.resolve(f)));
const tsxFiles = fs.existsSync(sourceRoot) ? walk(sourceRoot, [".tsx", ".jsx"]) : [];

const violations = [];

for (const file of cssFiles) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (COLOR_RE.test(lines[i])) {
      violations.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${lines[i].trim()}`);
    }
  }
}

for (const file of tsxFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(INLINE_STYLE_RE)) {
    const block = match[0];
    if (!COLOR_RE.test(block)) continue;
    const line = text.slice(0, match.index ?? 0).split(/\r?\n/).length;
    const snippet = block.replace(/\s+/g, " ").slice(0, 180);
    violations.push(`${path.relative(process.cwd(), file)}:${line}: ${snippet}`);
  }

  for (const match of text.matchAll(STYLE_OBJECT_RE)) {
    const block = match[0];
    if (!COLOR_RE.test(block)) continue;
    const line = text.slice(0, match.index ?? 0).split(/\r?\n/).length;
    const snippet = block.replace(/\s+/g, " ").slice(0, 180);
    violations.push(`${path.relative(process.cwd(), file)}:${line}: ${snippet}`);
  }
}

if (violations.length) {
  console.error("Theme color literals found outside theme foundation files:\n");
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("OK: No theme color literals outside theme foundation files");
