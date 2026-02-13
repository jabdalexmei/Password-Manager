import fs from "node:fs";
import path from "node:path";

const stylesRoot = path.resolve("src/styles");
const themeFile = path.resolve("src/styles/themes/blueTheme.css");

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

const files = walk(stylesRoot).filter((f) => path.resolve(f) !== themeFile);

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
  console.error("Theme color literals found outside blueTheme.css:\n");
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("OK: No theme color literals outside blueTheme.css");

