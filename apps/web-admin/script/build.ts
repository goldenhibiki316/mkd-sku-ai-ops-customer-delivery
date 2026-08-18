import { execFileSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';

import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';

const FULL_SHA = /^[0-9a-f]{40}$/i;

function gitValue(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function resolveVersion() {
  const environmentSha = process.env.APP_COMMIT_SHA?.trim() || '';
  const repositorySha = gitValue(['rev-parse', 'HEAD']) || '';
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH?.trim() || '';
  const sourceDateEpochSeconds = /^\d{1,12}$/.test(sourceDateEpoch)
    ? Number(sourceDateEpoch)
    : null;
  const builtAt = sourceDateEpochSeconds !== null
    && Number.isSafeInteger(sourceDateEpochSeconds)
    ? new Date(sourceDateEpochSeconds * 1000).toISOString()
    : new Date().toISOString();
  const commitSha = FULL_SHA.test(environmentSha)
    ? environmentSha
    : FULL_SHA.test(repositorySha)
      ? repositorySha
      : 'unknown';
  return {
    commit_sha: commitSha,
    branch: process.env.APP_BRANCH?.trim()
      || gitValue(['branch', '--show-current'])
      || 'unknown',
    built_at: builtAt,
    working_tree_dirty: Boolean(gitValue(['status', '--porcelain'])),
    application: 'mkd-customer-ops-web' as const,
  };
}

async function buildAll() {
  const version = resolveVersion();
  await rm('dist', { recursive: true, force: true });

  await viteBuild({
    build: {
      sourcemap: false,
    },
  });

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: 'node',
    packages: 'external',
    bundle: true,
    format: 'cjs',
    outfile: 'dist/index.cjs',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    define: {
      'process.env.NODE_ENV': '"production"',
      __APP_COMMIT_SHA__: JSON.stringify(version.commit_sha),
      __APP_BRANCH__: JSON.stringify(version.branch),
      __APP_BUILT_AT__: JSON.stringify(version.built_at),
      __APP_DIRTY__: JSON.stringify(version.working_tree_dirty),
    },
    logLevel: 'info',
  });

  await writeFile(
    'dist/version.json',
    `${JSON.stringify(version, null, 2)}\n`,
    'utf8',
  );
}

buildAll().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
