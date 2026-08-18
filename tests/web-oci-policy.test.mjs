import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

async function mustRead(relativePath) {
  const absolutePath = path.join(root, relativePath);
  await access(absolutePath);
  return readFile(absolutePath, 'utf8');
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

  for (const marker of [
    'ARG WEB_COMMIT_SHA',
    'ARG SOURCE_DATE_EPOCH',
    'npm ci --ignore-scripts',
    'npm test',
    'npm run check --prefix apps/web-admin',
    'npm run test:customer --prefix apps/web-admin',
    'npm run build --prefix apps/web-admin',
    'npm prune --omit=dev --ignore-scripts',
    'USER 65532:65532',
    'ENV NODE_ENV=production',
    'ENV PORT=8080',
    'COPY --from=build --chown=65532:65532 /src/apps/web-admin/dist ./dist',
    'COPY --from=build --chown=65532:65532 /src/apps/web-admin/node_modules ./node_modules',
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
    'dist',
    '.env',
    '*.key',
    '*.pem',
    '*.map',
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
