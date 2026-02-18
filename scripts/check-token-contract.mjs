import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const THEME_FILES = [
  path.resolve("src/shared/styles/themes/blueTheme.css"),
  path.resolve("src/shared/styles/themes/darkTheme.css"),
];
const SEMANTIC_FILE = path.resolve("src/shared/styles/tokens/semantic.css");
const COMPONENTS_FILE = path.resolve("src/shared/styles/tokens/components.css");

const LEGACY_TOKEN_RE = /--(?:color-|surface-|btn-secondary|greycolorsecondary|blueprimarycolor|input-surface|border-subtle|focus-ring|focus-border|primary-soft-bg|success-soft-bg|danger-soft-bg|danger-border-weak|danger-hover-bg|bg-screen)/;
const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/;
const CUSTOM_PROP_RE = /--([a-z0-9-]+)\s*:/g;
const VAR_REF_RE = /var\(\s*(--[a-z0-9-]+)/g;
const SRC_EXTS = new Set([".css", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html"]);

const errors = [];

function readFile(file) {
  if (!fs.existsSync(file)) {
    errors.push(`Missing required file: ${path.relative(ROOT, file)}`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function getCustomProps(text) {
  const props = [];
  for (const match of text.matchAll(CUSTOM_PROP_RE)) {
    props.push(match[1]);
  }
  return props;
}

function getVarRefs(text) {
  const refs = [];
  for (const match of text.matchAll(VAR_REF_RE)) {
    refs.push(match[1]);
  }
  return refs;
}

function unique(list) {
  return [...new Set(list)];
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (SRC_EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const themePropSets = [];
for (const file of THEME_FILES) {
  const rel = path.relative(ROOT, file);
  const text = readFile(file);
  if (!text) continue;

  if (text.includes("var(")) {
    errors.push(`${rel}: theme foundation must not use var(...) references`);
  }

  const props = getCustomProps(text);
  if (!props.length) {
    errors.push(`${rel}: no custom properties were found`);
    continue;
  }

  const nonFdProps = unique(props.filter((name) => !name.startsWith("fd-")));
  if (nonFdProps.length) {
    errors.push(`${rel}: found non-foundation tokens: ${nonFdProps.map((name) => `--${name}`).join(", ")}`);
  }

  themePropSets.push(new Set(props.filter((name) => name.startsWith("fd-"))));
}

if (themePropSets.length === 2) {
  const [blueSet, darkSet] = themePropSets;
  const onlyBlue = [...blueSet].filter((name) => !darkSet.has(name)).sort();
  const onlyDark = [...darkSet].filter((name) => !blueSet.has(name)).sort();

  if (onlyBlue.length || onlyDark.length) {
    if (onlyBlue.length) {
      errors.push(`Theme contract mismatch: only in blueTheme.css: ${onlyBlue.map((name) => `--${name}`).join(", ")}`);
    }
    if (onlyDark.length) {
      errors.push(`Theme contract mismatch: only in darkTheme.css: ${onlyDark.map((name) => `--${name}`).join(", ")}`);
    }
  }
}

{
  const rel = path.relative(ROOT, SEMANTIC_FILE);
  const text = readFile(SEMANTIC_FILE);
  if (text) {
    const props = getCustomProps(text);
    const nonSemProps = unique(props.filter((name) => !name.startsWith("sem-")));
    if (nonSemProps.length) {
      errors.push(`${rel}: found non-semantic tokens: ${nonSemProps.map((name) => `--${name}`).join(", ")}`);
    }

    const refs = getVarRefs(text);
    const badRefs = unique(refs.filter((name) => !name.startsWith("--fd-")));
    if (badRefs.length) {
      errors.push(`${rel}: semantic tokens must only reference foundation tokens, found: ${badRefs.join(", ")}`);
    }

    if (COLOR_LITERAL_RE.test(text)) {
      errors.push(`${rel}: semantic layer must not contain raw color literals`);
    }
  }
}

{
  const rel = path.relative(ROOT, COMPONENTS_FILE);
  const text = readFile(COMPONENTS_FILE);
  if (text) {
    const props = getCustomProps(text);
    const nonCmpProps = unique(props.filter((name) => !name.startsWith("cmp-")));
    if (nonCmpProps.length) {
      errors.push(`${rel}: found non-component tokens: ${nonCmpProps.map((name) => `--${name}`).join(", ")}`);
    }

    const refs = getVarRefs(text);
    const badRefs = unique(refs.filter((name) => name.startsWith("--fd-")));
    if (badRefs.length) {
      errors.push(`${rel}: component layer must not reference foundation tokens directly, found: ${badRefs.join(", ")}`);
    }

    if (COLOR_LITERAL_RE.test(text)) {
      errors.push(`${rel}: component layer must not contain raw color literals`);
    }
  }
}

for (const file of walk(path.resolve("src"))) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (LEGACY_TOKEN_RE.test(lines[i])) {
      errors.push(`${rel}:${i + 1}: legacy token usage detected: ${lines[i].trim()}`);
    }
  }
}

if (errors.length) {
  console.error("Theme token contract check failed:\n");
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("OK: Theme token contract is valid");
