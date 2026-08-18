import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

async function mustRead(relativePath) {
  const absolutePath = path.join(root, relativePath);
  await access(absolutePath);
  return readFile(absolutePath, 'utf8');
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function writeOciFixture(root, layerContent) {
  const ociRoot = path.join(root, 'oci');
  const blobsRoot = path.join(ociRoot, 'blobs', 'sha256');
  const layerRoot = path.join(root, 'layer');
  await mkdir(path.join(layerRoot, 'app', 'dist'), { recursive: true });
  await mkdir(blobsRoot, { recursive: true });
  await writeFile(
    path.join(layerRoot, 'app', 'dist', 'index.cjs'),
    layerContent,
  );

  const layerPath = path.join(root, 'layer.tar');
  execFileSync('tar', ['-cf', layerPath, '-C', layerRoot, '.']);
  const layerBytes = await readFile(layerPath);
  const layerDigest = sha256(layerBytes);
  await copyFile(layerPath, path.join(blobsRoot, layerDigest));

  const configBytes = Buffer.from(JSON.stringify({
    architecture: 'amd64',
    os: 'linux',
    config: {
      User: '65532:65532',
      Entrypoint: ['/nodejs/bin/node'],
      Cmd: ['dist/index.cjs'],
      Env: [
        'NODE_ENV=production',
        'PORT=8080',
        'DOTENV_CONFIG_PATH=/run/secrets/mkd-web.env',
      ],
    },
  }));
  const configDigest = sha256(configBytes);
  await writeFile(path.join(blobsRoot, configDigest), configBytes);

  const manifestBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    config: {
      mediaType: 'application/vnd.oci.image.config.v1+json',
      digest: `sha256:${configDigest}`,
      size: configBytes.length,
    },
    layers: [{
      mediaType: 'application/vnd.oci.image.layer.v1.tar',
      digest: `sha256:${layerDigest}`,
      size: layerBytes.length,
    }],
  }));
  const manifestDigest = sha256(manifestBytes);
  await writeFile(path.join(blobsRoot, manifestDigest), manifestBytes);
  await writeFile(
    path.join(ociRoot, 'index.json'),
    JSON.stringify({
      schemaVersion: 2,
      manifests: [{
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        digest: `sha256:${manifestDigest}`,
        size: manifestBytes.length,
      }],
    }),
  );
  await writeFile(
    path.join(ociRoot, 'oci-layout'),
    JSON.stringify({ imageLayoutVersion: '1.0.0' }),
  );

  const archivePath = path.join(root, 'mkd-web-linux-amd64.oci.tar');
  execFileSync('tar', ['-cf', archivePath, '-C', ociRoot, '.']);
  const archiveBytes = await readFile(archivePath);
  const sumsPath = path.join(root, 'SHA256SUMS');
  await writeFile(
    sumsPath,
    `${sha256(archiveBytes)}  ${path.basename(archivePath)}\n`,
  );
  return { archivePath, sumsPath };
}

test('Web OCI uses pinned build and distroless runtime images', async () => {
  const containerfile = await mustRead('container/web/Containerfile');
  const fromLines = containerfile
    .split(/\r?\n/u)
    .filter((line) => /^FROM\s+/u.test(line));

  assert.equal(fromLines.length, 2);
  assert.match(
    containerfile,
    /^ARG NODE_BUILD_IMAGE=node:22-bookworm-slim@sha256:[0-9a-f]{64}$/mu,
  );
  assert.match(
    containerfile,
    /^ARG NODE_RUNTIME_IMAGE=gcr\.io\/distroless\/nodejs22-debian13:nonroot@sha256:[0-9a-f]{64}$/mu,
  );
  assert.equal(fromLines[0], 'FROM ${NODE_BUILD_IMAGE} AS build');
  assert.equal(fromLines[1], 'FROM ${NODE_RUNTIME_IMAGE}');
});

test('Web OCI builds a tested immutable commit and copies only runtime assets', async () => {
  const containerfile = await mustRead('container/web/Containerfile');
  const rootPackage = JSON.parse(await mustRead('package.json'));
  const webPackage = JSON.parse(await mustRead('apps/web-admin/package.json'));

  for (const marker of [
    'ARG WEB_COMMIT_SHA',
    'ARG SOURCE_DATE_EPOCH',
    'npm ci --ignore-scripts',
    'npm run test:container',
    'npm run check --prefix apps/web-admin',
    'npm run test:customer --prefix apps/web-admin',
    'npm run build --prefix apps/web-admin',
    'npm ci --omit=dev --ignore-scripts --prefix /runtime',
    'find /runtime/node_modules -type f',
    'USER 65532:65532',
    'ENV NODE_ENV=production',
    'ENV PORT=8080',
    'COPY --from=build --chown=65532:65532 /src/apps/web-admin/dist ./dist',
    'COPY --from=build --chown=65532:65532 /runtime/node_modules ./node_modules',
    'CMD ["dist/index.cjs"]',
  ]) {
    assert.equal(containerfile.includes(marker), true, `missing ${marker}`);
  }

  const runtimeStage = containerfile.split(/\nFROM\s+/u).at(-1) ?? '';
  assert.doesNotMatch(runtimeStage, /COPY\s+(?:--[^\s]+\s+)*\.\s+/u);
  assert.doesNotMatch(
    runtimeStage,
    /COPY[^\n]+\/(?:server|client|shared|tests|script)(?:\s|\/)/u,
  );
  assert.doesNotMatch(runtimeStage, /(?:npm|npx|apt-get|apk)\s/u);
  assert.deepEqual(
    Object.keys(webPackage.dependencies).filter((name) => name.startsWith('@types/')),
    [],
    'type-only packages must stay out of the runtime dependency graph',
  );
  assert.equal(
    rootPackage.scripts['test:container'],
    'node --test tests/delivery-boundary.test.mjs tests/web-oci-policy.test.mjs',
  );
});

test('Web OCI build identity uses the source commit timestamp', async () => {
  const containerfile = await mustRead('container/web/Containerfile');
  const build = await mustRead('apps/web-admin/script/build.ts');

  assert.match(containerfile, /SOURCE_DATE_EPOCH/u);
  assert.match(build, /process\.env\.SOURCE_DATE_EPOCH/u);
  assert.match(build, /sourceDateEpoch/u);
  assert.match(build, /process\.env\.APP_BRANCH/u);
});

test('Web OCI public runtime contract enforces least privilege', async () => {
  const contract = JSON.parse(await mustRead('container/web/runtime-contract.json'));

  assert.deepEqual(contract, {
    schema: 'mkd-web-runtime/v1',
    container_port: 8080,
    user: '65532:65532',
    read_only_root: true,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges'],
    tmpfs: ['/tmp:rw,noexec,nosuid,size=16m'],
    readonly_config_mount: '/run/secrets/mkd-web.env',
    socket_mount: '/run/mkd-core',
    health_path: '/api/health',
    version_path: '/api/version',
  });
});

test('Web OCI build emits separate archives for both customer architectures', async () => {
  const script = await mustRead('scripts/build-web-oci.sh');

  assert.match(script, /linux\/amd64/u);
  assert.match(script, /linux\/arm64/u);
  assert.match(script, /WEB_COMMIT_SHA/u);
  assert.match(script, /SOURCE_DATE_EPOCH/u);
  assert.match(script, /NODE_BUILD_IMAGE/u);
  assert.match(script, /NODE_RUNTIME_IMAGE/u);
  assert.match(script, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(script, /type=oci/u);
  assert.match(script, /mkd-web-linux-amd64\.oci\.tar/u);
  assert.match(script, /mkd-web-linux-arm64\.oci\.tar/u);
  assert.match(script, /SHA256SUMS/u);
  assert.match(script, /npm test/u);
  assert.match(script, /verify-git-history\.sh/u);
});

test('Web OCI verifier and build context exclusions are present', async () => {
  const verifier = await mustRead('scripts/verify-web-oci.sh');
  const dockerignore = await mustRead('.dockerignore');

  for (const marker of [
    'runtime-contract.json',
    'index.json',
    'manifest',
    'config',
    '65532:65532',
    'SHA256SUMS',
  ]) {
    assert.equal(verifier.includes(marker), true, `verifier missing ${marker}`);
  }
  for (const excluded of [
    '.git',
    'node_modules',
    '**/node_modules',
    'dist',
    '**/dist',
    '.env',
    '**/.env*',
    '!apps/web-admin/.env.example',
    '*.key',
    '*.pem',
    '*.map',
    '**/*.map',
    'docs',
    'internal',
  ]) {
    assert.equal(
      dockerignore.split(/\r?\n/u).includes(excluded),
      true,
      `.dockerignore missing ${excluded}`,
    );
  }
});

test('Web OCI verifier rejects protected plaintext inside an allowed layer path', async (context) => {
  const missingHostTools = ['grep', 'jq', 'shasum', 'strings', 'tar']
    .filter((command) => spawnSync(
      'sh',
      ['-c', `command -v ${command} >/dev/null 2>&1`],
      { encoding: 'utf8' },
    ).status !== 0);
  if (missingHostTools.length > 0) {
    context.skip(`host release tools unavailable: ${missingHostTools.join(', ')}`);
    return;
  }
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'mkd-web-oci-test-'));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const { archivePath, sumsPath } = await writeOciFixture(
    fixtureRoot,
    `const protectedRules = "${['SOP', 'V3', 'MATRIX'].join('_')}";\n`,
  );
  const verifier = path.join(root, 'scripts', 'verify-web-oci.sh');
  const result = spawnSync(
    'bash',
    [verifier, archivePath, 'linux/amd64', sumsPath],
    { encoding: 'utf8' },
  );

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /forbidden Web OCI layer content/u);
});
