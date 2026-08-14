import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_PATHS = [
  'apps/web-admin/client',
  'apps/web-admin/server',
  'apps/web-admin/shared',
  'apps/web-admin/package.json',
];

const FORBIDDEN_EXTENSIONS = new Set([
  '.md',
  '.doc',
  '.docx',
  '.pdf',
  '.map',
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.crt',
]);

const TEXT_EXTENSIONS = new Set([
  '',
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.mjs',
  '.cjs',
  '.sh',
  '.sql',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const FORBIDDEN_MARKERS = [
  ['SOP', 'V3', 'MATRIX'].join('_'),
  ['OFFICIAL', 'RULES', 'DIGEST'].join('_'),
  ['ADS', 'PROMOTION', 'SOP'].join('_'),
  ['LEARNED', 'FROM', 'HISTORY', 'SOP'].join('_'),
  ['OPENAI', 'API', 'KEY'].join('_'),
  ['MINELONA', 'API', 'KEY'].join('_'),
  ['chat', 'completions'].join('/'),
  ['seven', 'fields', 'weekly'].join('_'),
  ['ruleTask', 'Generator'].join(''),
  ['01', 'refresh', 'metrics.sql'].join('_'),
  ['02', 'refresh', 'classification.sql'].join('_'),
  ['12,988', '条历史调价'].join(' '),
  ['33', '万条状态变化'].join(' '),
  ['你是美客多智利站', '专属运营顾问'].join(''),
  ['严格依以下结构', '输出'].join(''),
];

const toPosix = (value) => value.split(path.sep).join('/');

function forbiddenPathReason(relativePath) {
  const normalized = toPosix(relativePath);
  const base = path.posix.basename(normalized);
  const lower = normalized.toLowerCase();
  const extension = path.posix.extname(lower);

  if (FORBIDDEN_EXTENSIONS.has(extension)) return `extension ${extension}`;
  if (base === '.DS_Store') return 'macOS metadata';
  if (/^readme(?:\.|$)/i.test(base)) return 'reader documentation';
  if (/^\.env(?:\.|$)/i.test(base) && base !== '.env.example') {
    return 'runtime environment file';
  }
  if (/(^|\/)docs?(\/|$)/i.test(normalized)) return 'documentation directory';
  if (/(^|\/)internal(\/|$)/i.test(normalized)) return 'internal directory';
  if (/(^|\/)server\/jobs(\/|$)/i.test(normalized)) return 'core job source';
  if (/(^|\/)sql\/seven-fields(\/|$)/i.test(normalized)) {
    return 'core calculation SQL';
  }
  return null;
}

async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(root, current = root) {
  const files = [];
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, absolutePath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolutePath));
    }
  }
  return files;
}

async function inspectMarkers(root, relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) return [];
  const absolutePath = path.join(root, relativePath);
  const metadata = await stat(absolutePath);
  if (metadata.size > 5 * 1024 * 1024) return [];
  const content = await readFile(absolutePath, 'utf8');
  return FORBIDDEN_MARKERS
    .filter((marker) => content.includes(marker))
    .map((marker) => `${toPosix(relativePath)}: protected marker ${marker}`);
}

export async function auditDeliveryTree(root) {
  const absoluteRoot = path.resolve(root);
  const requiredMissing = [];
  for (const requiredPath of REQUIRED_PATHS) {
    if (!await exists(path.join(absoluteRoot, requiredPath))) {
      requiredMissing.push(requiredPath);
    }
  }

  const files = await collectFiles(absoluteRoot);
  const forbiddenPaths = [];
  const forbiddenMarkers = [];
  for (const relativePath of files) {
    const reason = forbiddenPathReason(relativePath);
    if (reason) forbiddenPaths.push(`${toPosix(relativePath)}: ${reason}`);
    forbiddenMarkers.push(...await inspectMarkers(absoluteRoot, relativePath));
  }

  return {
    requiredMissing: requiredMissing.sort(),
    forbiddenPaths: forbiddenPaths.sort(),
    forbiddenMarkers: forbiddenMarkers.sort(),
  };
}

async function main() {
  const result = await auditDeliveryTree(process.cwd());
  const ok = Object.values(result).every((items) => items.length === 0);
  process.stdout.write(`${JSON.stringify({ ok, ...result }, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  await main();
}
