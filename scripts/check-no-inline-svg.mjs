import fs from "node:fs";
import path from "node:path";

const SRC_ROOT = path.resolve("src");
const RE = /<svg\b/;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")))
      out.push(full);
  }
  return out;
}

const files = walk(SRC_ROOT);

const violations = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  if (RE.test(text)) violations.push(path.relative(process.cwd(), file));
}

if (violations.length) {
  console.error("Inline <svg> found in source files (must use lucide-react icons only):\n");
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("OK: No inline <svg> in src/");
