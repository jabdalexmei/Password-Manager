import fs from 'node:fs';
import path from 'node:path';

const [, , inputArg, outputArg] = process.argv;

if (!inputArg) {
  console.error('Usage: node scripts/legacy-txt-to-csv.mjs <input.txt> [output.csv]');
  process.exit(1);
}

const inputPath = path.resolve(inputArg);
const outputPath =
  outputArg
    ? path.resolve(outputArg)
    : path.join(path.dirname(inputPath), `${path.parse(inputPath).name}.review.csv`);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i;

function isSeparator(line) {
  return /^_{5,}$/.test(line.trim());
}

function isEmail(value) {
  return EMAIL_RE.test(value.trim());
}

function isUrlLike(value) {
  return URL_RE.test(value.trim());
}

function escapeCsv(value) {
  const normalized = String(value ?? '');
  if (/[",\r\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function splitBlocks(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let current = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (isSeparator(line)) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current);
  }

  return blocks;
}

function suggestFields(lines) {
  const nonEmpty = lines.filter(Boolean);
  const password = nonEmpty.length > 0 ? nonEmpty[nonEmpty.length - 1] : '';
  const body = nonEmpty.slice(0, Math.max(0, nonEmpty.length - 1));

  let url = '';
  let email = '';
  let username = '';
  let title = '';
  const leftovers = [];

  for (const line of body) {
    if (!email && isEmail(line)) {
      email = line;
      continue;
    }
    if (!url && isUrlLike(line)) {
      url = line;
      continue;
    }
    leftovers.push(line);
  }

  if (leftovers.length > 0) {
    title = leftovers[0];
  }
  if (leftovers.length > 1 && !username) {
    username = leftovers[1];
  }

  const note = leftovers.slice(2).join('\n');

  return {
    title,
    url,
    email,
    recoveryEmail: '',
    username,
    password,
    mobilePhone: '',
    note,
    tags: '',
    folder: '',
  };
}

const content = fs.readFileSync(inputPath, 'utf8');
const blocks = splitBlocks(content);

const headers = [
  'title',
  'url',
  'email',
  'recoveryEmail',
  'username',
  'password',
  'mobilePhone',
  'note',
  'tags',
  'folder',
  'raw_block',
  'raw_line_1',
  'raw_line_2',
  'raw_line_3',
  'raw_line_4_plus',
];

const rows = blocks.map((lines) => {
  const suggested = suggestFields(lines);
  return {
    ...suggested,
    raw_block: lines.join('\n'),
    raw_line_1: lines[0] ?? '',
    raw_line_2: lines[1] ?? '',
    raw_line_3: lines[2] ?? '',
    raw_line_4_plus: lines.slice(3).join('\n'),
  };
});

const csv = [
  headers.join(','),
  ...rows.map((row) => headers.map((header) => escapeCsv(row[header] ?? '')).join(',')),
].join('\r\n');

fs.writeFileSync(outputPath, `\uFEFF${csv}`, 'utf8');
console.log(`Wrote ${rows.length} rows to ${outputPath}`);
