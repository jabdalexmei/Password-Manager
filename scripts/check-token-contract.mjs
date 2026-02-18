import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const THEME_FILES = [
  path.resolve("src/shared/styles/themes/blueTheme.css"),
  path.resolve("src/shared/styles/themes/darkTheme.css"),
];
const SEMANTIC_FILE = path.resolve("src/shared/styles/tokens/semantic.css");
const COMPONENTS_FILE = path.resolve("src/shared/styles/tokens/components.css");
const REQUIRED_FOUNDATION_TOKENS = [
  "fd-bg-screens-workspace-create-login-select",
  "fd-vault-columns-bg",
  "fd-category-navigation-folders-buttons-bg",
  "fd-category-navigation-folders-buttons-border",
  "fd-category-navigation-folders-buttons-text",
  "fd-category-navigation-folders-buttons-hover-bg",
  "fd-category-navigation-folders-buttons-hover-border",
  "fd-category-navigation-folders-buttons-active-bg",
  "fd-category-navigation-folders-buttons-active-border",
  "fd-category-navigation-folders-buttons-active-text",
  "fd-category-navigation-folders-buttons-count",
  "fd-card-active-bg",
];
const REQUIRED_SEMANTIC_TOKENS = [
  "sem-bg-screens-workspace-create-login-select",
  "sem-vault-columns-bg",
  "sem-category-navigation-folders-buttons-bg",
  "sem-category-navigation-folders-buttons-border",
  "sem-category-navigation-folders-buttons-text",
  "sem-category-navigation-folders-buttons-hover-bg",
  "sem-category-navigation-folders-buttons-hover-border",
  "sem-category-navigation-folders-buttons-active-bg",
  "sem-category-navigation-folders-buttons-active-border",
  "sem-category-navigation-folders-buttons-active-text",
  "sem-category-navigation-folders-buttons-count",
  "sem-card-active-bg",
];
const REQUIRED_COMPONENT_TOKENS = [
  "cmp-vault-columns-bg",
  "cmp-category-navigation-folders-buttons-bg",
  "cmp-category-navigation-folders-buttons-border",
  "cmp-category-navigation-folders-buttons-text",
  "cmp-category-navigation-folders-buttons-hover-bg",
  "cmp-category-navigation-folders-buttons-hover-border",
  "cmp-category-navigation-folders-buttons-active-bg",
  "cmp-category-navigation-folders-buttons-active-border",
  "cmp-category-navigation-folders-buttons-active-text",
  "cmp-category-navigation-folders-buttons-count",
  "cmp-card-active-bg",
];
const FORBIDDEN_PRE_VAULT_BG_TOKENS = [
  "--fd-bg-startup",
  "--fd-bg-login",
  "--fd-bg-profile-create",
  "--sem-bg-screen-startup",
  "--sem-bg-screen-login",
  "--sem-bg-screen-profile-create",
  "--sem-bg-screen",
];
const FORBIDDEN_SIDEBAR_BUTTON_TOKENS = [
  "--fd-nav-chip-bg",
  "--fd-nav-chip-border",
  "--fd-nav-chip-text",
  "--fd-nav-chip-hover-border",
  "--fd-nav-chip-active-bg",
  "--fd-nav-chip-active-border",
  "--fd-nav-chip-active-text",
  "--fd-nav-folder-bg",
  "--fd-nav-folder-border",
  "--fd-nav-folder-text",
  "--fd-nav-folder-count",
  "--fd-nav-folder-hover-bg",
  "--fd-nav-folder-hover-border",
  "--fd-nav-folder-active-bg-start",
  "--fd-nav-folder-active-bg-end",
  "--fd-nav-folder-active-border",
  "--sem-nav-chip-bg",
  "--sem-nav-chip-border",
  "--sem-nav-chip-text",
  "--sem-nav-chip-hover-border",
  "--sem-nav-chip-active-bg",
  "--sem-nav-chip-active-border",
  "--sem-nav-chip-active-text",
  "--sem-nav-folder-bg",
  "--sem-nav-folder-border",
  "--sem-nav-folder-text",
  "--sem-nav-folder-count",
  "--sem-nav-folder-hover-bg",
  "--sem-nav-folder-hover-border",
  "--sem-nav-folder-active-bg-start",
  "--sem-nav-folder-active-bg-end",
  "--sem-nav-folder-active-border",
  "--cmp-nav-chip-bg",
  "--cmp-nav-chip-border",
  "--cmp-nav-chip-text",
  "--cmp-nav-chip-hover-border",
  "--cmp-nav-chip-active-bg",
  "--cmp-nav-chip-active-border",
  "--cmp-nav-chip-active-text",
  "--cmp-nav-folder-bg",
  "--cmp-nav-folder-border",
  "--cmp-nav-folder-text",
  "--cmp-nav-folder-count",
  "--cmp-nav-folder-hover-bg",
  "--cmp-nav-folder-hover-border",
  "--cmp-nav-folder-active-bg-start",
  "--cmp-nav-folder-active-bg-end",
  "--cmp-nav-folder-active-border",
];
const FORBIDDEN_CARD_ACTIVE_GRADIENT_TOKENS = [
  `--fd-card-active-bg-${"start"}`,
  `--fd-card-active-bg-${"end"}`,
  `--sem-card-active-bg-${"start"}`,
  `--sem-card-active-bg-${"end"}`,
  `--cmp-card-active-bg-${"start"}`,
  `--cmp-card-active-bg-${"end"}`,
];
const LEGACY_NAV_SIDEBAR_BG_SUFFIX = ["nav", "sidebar", "bg"].join("-");
const FORBIDDEN_LEGACY_VAULT_BG_TOKENS = [
  `--fd-${LEGACY_NAV_SIDEBAR_BG_SUFFIX}`,
  `--sem-${LEGACY_NAV_SIDEBAR_BG_SUFFIX}`,
  `--cmp-${LEGACY_NAV_SIDEBAR_BG_SUFFIX}`,
];

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasExactToken(line, token) {
  const re = new RegExp(`${escapeRegExp(token)}(?![a-z0-9-])`);
  return re.test(line);
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

  for (const required of REQUIRED_FOUNDATION_TOKENS) {
    if (!props.includes(required)) {
      errors.push(`${rel}: missing required foundation token --${required}`);
    }
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

    for (const required of REQUIRED_SEMANTIC_TOKENS) {
      if (!props.includes(required)) {
        errors.push(`${rel}: missing required semantic token --${required}`);
      }
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

    for (const required of REQUIRED_COMPONENT_TOKENS) {
      if (!props.includes(required)) {
        errors.push(`${rel}: missing required component token --${required}`);
      }
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

    for (const forbidden of FORBIDDEN_PRE_VAULT_BG_TOKENS) {
      if (hasExactToken(lines[i], forbidden)) {
        errors.push(`${rel}:${i + 1}: forbidden pre-vault bg token detected: ${forbidden}`);
      }
    }

    for (const forbidden of FORBIDDEN_SIDEBAR_BUTTON_TOKENS) {
      if (hasExactToken(lines[i], forbidden)) {
        errors.push(`${rel}:${i + 1}: forbidden sidebar button token detected: ${forbidden}`);
      }
    }

    for (const forbidden of FORBIDDEN_CARD_ACTIVE_GRADIENT_TOKENS) {
      if (hasExactToken(lines[i], forbidden)) {
        errors.push(`${rel}:${i + 1}: forbidden card active gradient token detected: ${forbidden}`);
      }
    }

    for (const forbidden of FORBIDDEN_LEGACY_VAULT_BG_TOKENS) {
      if (hasExactToken(lines[i], forbidden)) {
        errors.push(`${rel}:${i + 1}: forbidden legacy vault columns token detected: ${forbidden}`);
      }
    }
  }
}

if (errors.length) {
  console.error("Theme token contract check failed:\n");
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("OK: Theme token contract is valid");
