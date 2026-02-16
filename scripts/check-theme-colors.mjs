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

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/;
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

const themeFiles = fs.existsSync(themesDir)
  ? new Set(walk(themesDir).map((f) => path.resolve(f)))
  : new Set();

const files = walk(stylesRoot).filter((f) => !themeFiles.has(path.resolve(f)));

const violations = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (COLOR_RE.test(lines[i])) {
      violations.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${lines[i].trim()}`);
    }
  }
}

if (violations.length) {
  console.error("Theme color literals found outside theme files:\n");
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("OK: No theme color literals outside theme files");
